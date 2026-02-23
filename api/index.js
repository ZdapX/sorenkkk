const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();

// --- CONFIG ---
// Pastikan URI MongoDB benar
const uri = "mongodb+srv://dafanation999_db_user:UXeB3cb4ow5b9Nr9@cluster0.bn6kvnj.mongodb.net/?appName=Cluster0";

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// --- MONGODB CONNECTION ---
let client;
let db;

async function connectDB() {
    if (db) return db;
    try {
        if (!client) {
            client = new MongoClient(uri, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                }
            });
            await client.connect();
            console.log("Database connected!");
        }
        db = client.db("ai_share_platform");
        return db;
    } catch (err) {
        console.error("Database Connection Failed:", err);
        throw err;
    }
}

// --- ROUTES ---

// 1. HOME
app.get('/', async (req, res) => {
    try {
        const database = await connectDB();
        const ais = await database.collection("ais").find().sort({ createdAt: -1 }).toArray();
        res.render('index', { ais: ais });
    } catch (e) { res.status(500).send("DB Error: " + e.message); }
});

// 2. CREATE AI PAGE
app.get('/create', (req, res) => {
    res.render('create');
});

// 3. API: CREATE AI PROCESS
app.post('/api/create-ai', async (req, res) => {
    try {
        const { name, image, description } = req.body;
        const database = await connectDB();
        
        const newAI = {
            name,
            image, 
            description, 
            createdAt: new Date()
        };
        
        const result = await database.collection("ais").insertOne(newAI);
        res.json({ success: true, id: result.insertedId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. CHAT PAGE
app.get('/chat/:id', async (req, res) => {
    try {
        const database = await connectDB();
        if (!ObjectId.isValid(req.params.id)) return res.send("Invalid AI ID");
        
        const ai = await database.collection("ais").findOne({ _id: new ObjectId(req.params.id) });
        if (!ai) return res.send("AI not found");
        
        res.render('chatai', { ai: ai });
    } catch (e) {
        res.send("Error loading AI: " + e.message);
    }
});

// 5. API: SEND MESSAGE (CORE FEATURE)
app.post('/api/chat', async (req, res) => {
    const { aiId, message, sessionId } = req.body;
    
    // 1. Validasi Input Dasar
    if (!aiId || !message) {
        return res.status(400).json({ reply: "Data tidak lengkap (AI ID atau pesan hilang)." });
    }

    try {
        const database = await connectDB();
        
        // 2. Ambil Data AI
        const ai = await database.collection("ais").findOne({ _id: new ObjectId(aiId) });
        if (!ai) return res.status(404).json({ error: "AI not found in DB" });

        // 3. Ambil API Key (Pastikan ada)
        const keyData = await database.collection("apikeys").findOne({ active: true });
        if (!keyData || !keyData.key) {
            console.error("No API Key found in Database");
            return res.status(500).json({ reply: "Sistem Error: CEO belum mengisi API Key." });
        }
        const apiKey = keyData.key;

        // 4. Ambil History Chat
        let chatSession = await database.collection("chats").findOne({ aiId: aiId, sessionId: sessionId });
        let messages = chatSession ? chatSession.messages : [];

        // Tambah pesan user
        messages.push({ role: "user", content: message });

        // 5. Siapkan Payload OpenRouter
        // Kita ganti model ke yang lebih stabil (Google Gemma 2 atau Llama 3 Free)
        const MODEL_ID = "google/gemma-2-9b-it:free"; 
        // Alternatif jika error: "meta-llama/llama-3.1-8b-instruct:free"
        
        const systemMessage = { role: "system", content: `Kamu adalah karakter bernama ${ai.name}. Deskripsi/Sifatmu: ${ai.description}. Jawablah dalam bahasa Indonesia yang natural sesuai karakter.` };
        
        // Ambil 6 pesan terakhir saja agar hemat token dan cepat
        const recentMessages = messages.slice(-6); 
        const payloadMessages = [systemMessage, ...recentMessages];

        console.log(`Sending to OpenRouter [${MODEL_ID}]...`);

        // 6. Request ke OpenRouter
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: MODEL_ID, 
            messages: payloadMessages,
            temperature: 0.7,
            max_tokens: 500
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://createaiandshare.vercel.app", 
                "X-Title": "My AI Share App"
            },
            timeout: 20000 // 20 detik timeout
        });

        const reply = response.data.choices[0].message.content;
        console.log("Success reply from AI");

        // 7. Simpan History
        messages.push({ role: "assistant", content: reply });
        await database.collection("chats").updateOne(
            { aiId: aiId, sessionId: sessionId },
            { $set: { messages: messages, updatedAt: new Date() } },
            { upsert: true }
        );

        res.json({ reply: reply });

    } catch (error) {
        // --- LOGGING ERROR DETAIL (CEK LOGS VERCEL DISINI) ---
        console.error("=== CHAT ERROR LOG ===");
        if (error.response) {
            // Error dari OpenRouter (misal: 400, 401, 402, 500)
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data));
            
            if (error.response.status === 401) {
                return res.status(500).json({ reply: "API Key Invalid/Expired. Hubungi CEO." });
            }
             if (error.response.status === 429) {
                return res.status(500).json({ reply: "Rate Limit tercapai. Coba lagi nanti." });
            }
        } else if (error.request) {
            // Tidak ada respon (Timeout / Network Error)
            console.error("No Response from OpenRouter (Timeout/Network)");
        } else {
            // Error Codingan
            console.error("Code Error:", error.message);
        }
        console.error("========================");

        res.status(500).json({ reply: "Maaf, AI sedang error. Coba lagi nanti." });
    }
});

// 6. CEO / ADMIN PAGE
app.get('/ceo', async (req, res) => {
    try {
        const database = await connectDB();
        const keys = await database.collection("apikeys").find().toArray();
        res.render('ceo', { keys });
    } catch(e) { res.send("DB Error"); }
});

app.post('/ceo/add-key', async (req, res) => {
    const { key } = req.body;
    const database = await connectDB();
    if(key) {
        await database.collection("apikeys").insertOne({ key, active: true });
    }
    res.redirect('/ceo');
});

app.post('/ceo/delete-key', async (req, res) => {
    const { id } = req.body;
    const database = await connectDB();
    if(id) {
        await database.collection("apikeys").deleteOne({ _id: new ObjectId(id) });
    }
    res.redirect('/ceo');
});

// Server Start
const PORT = process.env.PORT || 3000;
module.exports = app;
