const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();

// --- CONFIG ---
const uri = "mongodb+srv://dafanation999_db_user:UXeB3cb4ow5b9Nr9@cluster0.bn6kvnj.mongodb.net/?appName=Cluster0";
const DEFAULT_API_KEY = "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";

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(bodyParser.json({ limit: '10mb' })); // Limit besar untuk gambar base64
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
    
    // Inisialisasi collection API keys jika kosong
    const keys = await db.collection("apikeys").find().toArray();
    if (keys.length === 0) {
        await db.collection("apikeys").insertOne({ key: DEFAULT_API_KEY, active: true });
    }
    
    return db;
}

// --- ROUTES ---

// 1. HOME & LIBRARY
app.get('/', async (req, res) => {
    const database = await connectDB();
    const ais = await database.collection("ais").find().sort({ _id: -1 }).toArray();
    res.render('index', { ais: ais });
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
            image, // Base64 string
            description, // Persona
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
        const ai = await database.collection("ais").findOne({ _id: new ObjectId(req.params.id) });
        
        if (!ai) return res.send("AI not found");
        
        res.render('chatai', { ai: ai });
    } catch (e) {
        res.send("Error loading AI");
    }
});

// 5. API: GET CHAT HISTORY
app.get('/api/chat-history/:aiId/:sessionId', async (req, res) => {
    const database = await connectDB();
    const history = await database.collection("chats").findOne({ 
        aiId: req.params.aiId, 
        sessionId: req.params.sessionId 
    });
    res.json(history ? history.messages : []);
});

// 6. API: SEND MESSAGE (OpenRouter)
app.post('/api/chat', async (req, res) => {
    const { aiId, message, sessionId } = req.body;
    
    const database = await connectDB();
    
    // Ambil Data AI
    const ai = await database.collection("ais").findOne({ _id: new ObjectId(aiId) });
    if (!ai) return res.status(404).json({ error: "AI not found" });

    // Ambil API Key (Rotasi sederhana)
    const keys = await database.collection("apikeys").find({ active: true }).toArray();
    const randomKeyObj = keys[Math.floor(Math.random() * keys.length)];
    const apiKey = randomKeyObj ? randomKeyObj.key : DEFAULT_API_KEY;

    // Ambil History Chat
    let chatSession = await database.collection("chats").findOne({ aiId: aiId, sessionId: sessionId });
    let messages = chatSession ? chatSession.messages : [];

    // Tambah pesan user
    messages.push({ role: "user", content: message });

    try {
        // Construct Payload untuk OpenRouter
        // System prompt dari deskripsi AI
        const systemMessage = { role: "system", content: ai.description };
        const payloadMessages = [systemMessage, ...messages];

        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model: "mistralai/mistral-7b-instruct:free", // Model gratis/murah untuk demo
            messages: payloadMessages
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://my-ai-app.vercel.app", 
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
        res.status(500).json({ error: "AI sedang sibuk atau kehabisan kuota." });
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
    if(key) {
        await database.collection("apikeys").insertOne({ key, active: true });
    }
    res.redirect('/ceo');
});

// Server Start (for local dev)
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
