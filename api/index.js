const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();

// --- CONFIG ---
const uri = "mongodb+srv://dafanation999_db_user:UXeB3cb4ow5b9Nr9@cluster0.bn6kvnj.mongodb.net/?appName=Cluster0";

// JANGAN PAKAI KEY LAMA YANG ERROR. 
// Biarkan kosong dulu, nanti isi lewat menu CEO setelah deploy.
const DEFAULT_API_KEY = ""; 

// Middleware
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
    if (!client) {
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });
        await client.connect();
    }
    db = client.db("ai_share_platform");
    return db;
}

// --- ROUTES ---

// 1. HOME
app.get('/', async (req, res) => {
    try {
        const database = await connectDB();
        const ais = await database.collection("ais").find().sort({ _id: -1 }).toArray();
        res.render('index', { ais: ais });
    } catch (e) { res.send("Error loading DB"); }
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
        // Validasi ID sebelum query
        if (!ObjectId.isValid(req.params.id)) return res.send("Invalid AI ID");
        
        const ai = await database.collection("ais").findOne({ _id: new ObjectId(req.params.id) });
        if (!ai) return res.send("AI not found");
        
        res.render('chatai', { ai: ai });
    } catch (e) {
        res.send("Error loading AI: " + e.message);
    }
});

// 5. API: SEND MESSAGE (OpenRouter)
app.post('/api/chat', async (req, res) => {
    const { aiId, message, sessionId } = req.body;
    
    try {
        const database = await connectDB();
        
        // Ambil Data AI
        const ai = await database.collection("ais").findOne({ _id: new ObjectId(aiId) });
        if (!ai) return res.status(404).json({ error: "AI not found" });

        // AMBIL API KEY DARI DATABASE
        const keys = await database.collection("apikeys").find({}).toArray();
        
        // Cek apakah ada key tersedia
        if (keys.length === 0) {
            return res.status(500).json({ reply: "Maaf, CEO belum memasukkan API Key yang valid." });
        }

        // Pilih random key
        const randomKeyObj = keys[Math.floor(Math.random() * keys.length)];
        const apiKey = randomKeyObj.key;

        // Ambil History Chat
        let chatSession = await database.collection("chats").findOne({ aiId: aiId, sessionId: sessionId });
        let messages = chatSession ? chatSession.messages : [];

        // Tambah pesan user
        messages.push({ role: "user", content: message });

        // Payload OpenRouter
        const systemMessage = { role: "system", content: ai.description };
        // Batasi history agar token tidak jebol (ambil 10 pesan terakhir)
        const recentMessages = messages.slice(-10); 
        const payloadMessages = [systemMessage, ...recentMessages];

        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            // Ganti model ke yang lebih stabil & gratis
            model: "mistralai/mistral-7b-instruct:free", 
            messages: payloadMessages
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://createaiandshare.vercel.app", 
                "X-Title": "My AI App"
            }
        });

        const reply = response.data.choices[0].message.content;

        // Tambah respon AI ke history
        messages.push({ role: "assistant", content: reply });

        // Simpan ke DB
        await database.collection("chats").updateOne(
            { aiId: aiId, sessionId: sessionId },
            { $set: { messages: messages, updatedAt: new Date() } },
            { upsert: true }
        );

        res.json({ reply: reply });

    } catch (error) {
        console.error("OpenRouter Error:", error.response?.data || error.message);
        
        // Tangkap error 401 spesifik
        if (error.response?.data?.error?.code === 401) {
             return res.status(500).json({ reply: "Error Sistem: API Key Expired/Invalid. Harap lapor ke CEO." });
        }

        res.status(500).json({ reply: "Maaf, AI sedang lelah (Server Error)." });
    }
});

// 7. CEO / ADMIN PAGE
app.get('/ceo', async (req, res) => {
    const database = await connectDB();
    const keys = await database.collection("apikeys").find().toArray();
    res.render('ceo', { keys });
});

app.post('/ceo/add-key', async (req, res) => {
    const { key } = req.body;
    const database = await connectDB();
    if(key && key.startsWith('sk-or-')) {
        await database.collection("apikeys").insertOne({ key, active: true });
    }
    res.redirect('/ceo');
});

// TAMBAHAN: DELETE KEY
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
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
