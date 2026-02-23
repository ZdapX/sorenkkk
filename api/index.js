const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();

// --- CONFIG ---
const uri = "mongodb+srv://dafanation999_db_user:UXeB3cb4ow5b9Nr9@cluster0.bn6kvnj.mongodb.net/?appName=Cluster0";

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));

// Limit besar untuk gambar, dan parsing JSON wajib ada
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// --- MONGODB CONNECTION (Optimized for Vercel) ---
let client;
let db;

async function connectDB() {
    if (db) return db;
    
    try {
        if (!client) {
            console.log("Connecting to MongoDB...");
            client = new MongoClient(uri, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                },
                // Tambahan opsi agar koneksi stabil di Vercel
                connectTimeoutMS: 10000, 
                socketTimeoutMS: 45000,
            });
            await client.connect();
            console.log("✅ MongoDB Connected!");
        }
        db = client.db("ai_share_platform");
        return db;
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
        throw err; // Lempar error agar ditangkap route
    }
}

// --- ROUTES ---

// 1. HOME
app.get('/', async (req, res) => {
    try {
        const database = await connectDB();
        const ais = await database.collection("ais").find().sort({ createdAt: -1 }).toArray();
        res.render('index', { ais: ais });
    } catch (e) { 
        console.error("Home Error:", e);
        res.status(500).send("Gagal memuat database."); 
    }
});

// 2. CREATE AI PAGE
app.get('/create', (req, res) => {
    res.render('create');
});

// 3. API: CREATE AI PROCESS
app.post('/api/create-ai', async (req, res) => {
    try {
        const { name, image, description } = req.body;
        // Validasi sederhana
        if(!name || !description) return res.status(400).json({success: false, error: "Nama dan deskripsi wajib diisi"});

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
        console.error("Create AI Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. CHAT PAGE
app.get('/chat/:id', async (req, res) => {
    try {
        const database = await connectDB();
        
        // Cek validitas ID agar tidak crash
        if (!req.params.id || req.params.id.length !== 24) {
             return res.send("<h1>Error: ID AI tidak valid.</h1><a href='/'>Kembali</a>");
        }

        const ai = await database.collection("ais").findOne({ _id: new ObjectId(req.params.id) });
        
        if (!ai) return res.send("<h1>AI tidak ditemukan.</h1><a href='/'>Kembali</a>");
        
        res.render('chatai', { ai: ai });
    } catch (e) {
        console.error("Page Chat Error:", e);
        res.send("Error memuat halaman chat.");
    }
});

// 5. API: SEND MESSAGE (CORE FEATURE - DEBUG MODE)
app.post('/api/chat', async (req, res) => {
    // 1. Log Request Masuk (Cek Logs Vercel Disini)
    console.log("📥 Incoming Chat Request:", JSON.stringify(req.body));

    const { aiId, message, sessionId } = req.body;

    // 2. Validasi Input Keras
    if (!aiId || !message) {
        console.error("❌ Error: Data tidak lengkap (aiId atau message hilang)");
        return res.status(400).json({ reply: "Error: Pesan atau ID AI tidak terbaca oleh server." });
    }

    try {
        const database = await connectDB();

        // 3. Validasi ObjectId Mongo
        let objectId;
        try {
            objectId = new ObjectId(aiId);
        } catch (err) {
            console.error("❌ Error: Format ID salah:", aiId);
            return res.status(400).json({ reply: "Error: ID AI rusak/tidak valid." });
        }
        
        // 4. Ambil Data AI
        const ai = await database.collection("ais").findOne({ _id: objectId });
        if (!ai) {
            console.error("❌ Error: AI tidak ada di database ID:", aiId);
            return res.status(404).json({ error: "AI tidak ditemukan." });
        }

        // 5. Ambil API Key
        const keyData = await database.collection("apikeys").findOne({ active: true });
        if (!keyData || !keyData.key) {
            console.error("❌ Error: Tidak ada API Key di database");
            return res.status(500).json({ reply: "Sistem: CEO belum mengisi API Key." });
        }

        // 6. Siapkan Pesan
        // Kita gunakan model "Microsoft Phi-3" (Sangat ringan & gratis untuk testing)
        // Jika masih error, ganti ke "google/gemma-2-9b-it:free"
        const MODEL_ID = "microsoft/phi-3-mini-128k-instruct:free";
        
        const systemMessage = { role: "system", content: `Kamu adalah ${ai.name}. Sifat: ${ai.description}. Jawab singkat dan jelas.` };
        const userMessage = { role: "user", content: message };

        console.log(`🚀 Sending to OpenRouter [${MODEL_ID}]...`);

        // 7. Request Axios
        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: MODEL_ID,
            messages: [systemMessage, userMessage], // Kirim 2 pesan saja agar ringan
            temperature: 0.7,
            max_tokens: 300
        }, {
            headers: {
                "Authorization": `Bearer ${keyData.key}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://createaiandshare.vercel.app", 
                "X-Title": "My AI App"
            },
            timeout: 15000 // Timeout 15 detik
        });

        console.log("✅ OpenRouter Response Status:", response.status);

        const reply = response.data.choices[0].message.content;

        // 8. Simpan History (Fire and Forget - agar respon ke user cepat)
        // Kita tidak await disini agar user langsung dapat balasan
        database.collection("chats").updateOne(
            { aiId: aiId, sessionId: sessionId },
            { 
                $push: { messages: { $each: [{ role: "user", content: message }, { role: "assistant", content: reply }] } },
                $set: { updatedAt: new Date() } 
            },
            { upsert: true }
        ).catch(err => console.error("History Save Error (Ignored):", err));

        // 9. Kirim Balasan
        res.json({ reply: reply });

    } catch (error) {
        // --- LOGGING ERROR TERPERINCI ---
        console.error("🚨 CRITICAL ERROR 🚨");
        if (error.response) {
            // Error dari OpenRouter
            console.error("OpenRouter Status:", error.response.status);
            console.error("OpenRouter Data:", JSON.stringify(error.response.data));
            
            if (error.response.status === 401) return res.status(500).json({ reply: "API Key Salah/Expired." });
            if (error.response.status === 402) return res.status(500).json({ reply: "Saldo OpenRouter Habis (Insufficient Credits)." });
            if (error.response.status === 429) return res.status(500).json({ reply: "Terlalu banyak request (Rate Limit)." });
            
        } else {
            // Error Koneksi / Code
            console.error("Internal Error:", error.message);
        }
        
        res.status(500).json({ reply: "Maaf, terjadi kesalahan sistem. Cek Logs." });
    }
});

// 6. CEO & TOOLS
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
    if(key) await database.collection("apikeys").insertOne({ key, active: true });
    res.redirect('/ceo');
});

app.post('/ceo/delete-key', async (req, res) => {
    const { id } = req.body;
    const database = await connectDB();
    if(id) await database.collection("apikeys").deleteOne({ _id: new ObjectId(id) });
    res.redirect('/ceo');
});

// Server Start
const PORT = process.env.PORT || 3000;
module.exports = app;
