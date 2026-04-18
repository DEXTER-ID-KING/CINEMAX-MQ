const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ==================== Middleware ====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== MongoDB Atlas Connection ====================
// ✅ Uses Atlas URI - works on any hosting (Vercel, Railway, Render, VPS, etc.)
const MONGODB_URI = process.env.MONGODB_URI || 
    'mongodb+srv://dexter:dexter4321@cluster0.ymfug48.mongodb.net/DEXTER_S?retryWrites=true&w=majority';

let isConnected = false;

const connectDB = async () => {
    if (isConnected) return;
    
    try {
        console.log('🔄 Connecting to MongoDB Atlas...');
        
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 30000,
            maxPoolSize: 10,
            // ❌ Removed family: 4 - not needed for Atlas
            // ❌ Removed localhost settings
        });
        
        isConnected = true;
        console.log('✅ MongoDB Atlas Connected!');
        console.log('📦 Database:', mongoose.connection.db.databaseName);
        console.log('🌐 Host:', mongoose.connection.host);
        
    } catch (err) {
        isConnected = false;
        console.error('❌ MongoDB Atlas Connection Error:', err.message);
        console.log('');
        console.log('💡 Fix Checklist:');
        console.log('   1. Check Atlas URI is correct');
        console.log('   2. Whitelist your IP in Atlas: Network Access → Add IP → 0.0.0.0/0');
        console.log('   3. Check username/password in URI');
        console.log('   4. Make sure cluster is not paused in Atlas dashboard');
        console.log('');
        console.log('   Retrying in 5 seconds...');
        setTimeout(connectDB, 5000);
    }
};

// Connection Events
mongoose.connection.on('connected', () => {
    isConnected = true;
    console.log('🟢 Mongoose connected to Atlas');
});

mongoose.connection.on('error', (err) => {
    isConnected = false;
    console.error('🔴 Mongoose error:', err.message);
});

mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.log('🔌 Mongoose disconnected. Reconnecting...');
    setTimeout(connectDB, 3000);
});

// Initial connection
connectDB();

// ==================== Models ====================
const EpisodeSchema = new mongoose.Schema({
    id: { type: String, default: () => Date.now().toString() },
    season: { type: Number, required: true },
    episode: { type: Number, required: true },
    title: String,
    quality: { type: String, default: 'HD' },
    videoUrl: String,
    directLink: String,
    telegramLink: String,
    driveLink: String,
    gofileFileId: String,
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const MovieSchema = new mongoose.Schema({
    title: { type: String, required: true },
    year: { type: Number, default: 2025 },
    rating: { type: Number, default: 7.0 },
    quality: { type: String, default: 'HD' },
    genre: String,
    language: { type: String, default: 'English' },
    type: { type: String, enum: ['movie', 'tv'], default: 'movie' },
    isTrending: { type: Boolean, default: false },
    isLatest: { type: Boolean, default: false },
    posterImg: String,
    videoUrl: String,
    directLink: String,
    telegramLink: String,
    driveLink: String,
    gofileFileId: String,
    description: String,
    views: { type: Number, default: 0 },
    episodes: [EpisodeSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Movie = mongoose.model('Movie', MovieSchema);

// ==================== Admin Auth ====================
const ADMIN_PIN = process.env.ADMIN_PIN || '200727';

const adminAuth = (req, res, next) => {
    const pin = req.headers['x-admin-pin'] || req.body?.pin;
    if (pin === ADMIN_PIN) return next();
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid admin PIN' });
};

// ==================== DB Check Middleware ====================
const checkDB = (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            error: 'Database not connected',
            message: 'MongoDB Atlas is not ready. Please wait...',
            readyState: mongoose.connection.readyState,
            tip: 'Check Atlas IP whitelist: 0.0.0.0/0'
        });
    }
    next();
};

// ==================== Routes ====================

// Health Check
app.get('/api/health', (req, res) => {
    const states = {
        0: 'disconnected',
        1: 'connected', 
        2: 'connecting',
        3: 'disconnecting'
    };
    res.json({
        status: 'ok',
        mongodb: states[mongoose.connection.readyState],
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host || 'not connected',
        database: mongoose.connection.db?.databaseName || 'not connected',
        timestamp: new Date().toISOString()
    });
});

// Get all movies
app.get('/api/movies', checkDB, async (req, res) => {
    try {
        const { type, trending, latest, search, limit } = req.query;
        let query = {};

        if (type) query.type = type;
        if (trending === 'true') query.isTrending = true;
        if (latest === 'true') query.isLatest = true;
        if (search) query.title = { $regex: search, $options: 'i' };

        const limitNum = parseInt(limit) || 200;

        const movies = await Movie
            .find(query)
            .sort({ createdAt: -1 })
            .limit(limitNum)
            .lean();

        res.json(movies);
    } catch (error) {
        console.error('Error fetching movies:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single movie
app.get('/api/movies/:id', checkDB, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id).lean();
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        res.json(movie);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create or Update movie
app.post('/api/movies', adminAuth, checkDB, async (req, res) => {
    try {
        const {
            id, title, year, rating, quality, genre, language, type,
            isTrending, isLatest, posterImg, videoUrl, directLink,
            telegramLink, driveLink, description, episodes, gofileFileId
        } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        let episodesArray = [];
        if (episodes) {
            episodesArray = typeof episodes === 'string'
                ? JSON.parse(episodes)
                : episodes;
        }

        const movieData = {
            title: title.trim(),
            year: parseInt(year) || 2025,
            rating: parseFloat(rating) || 7.0,
            quality: quality || 'HD',
            genre: genre || '',
            language: language || 'English',
            type: type || 'movie',
            isTrending: isTrending === 'true' || isTrending === true,
            isLatest: isLatest === 'true' || isLatest === true,
            posterImg: posterImg || '',
            videoUrl: videoUrl || '',
            directLink: directLink || videoUrl || '',
            telegramLink: telegramLink || '',
            driveLink: driveLink || '',
            gofileFileId: gofileFileId || '',
            description: description || '',
            episodes: episodesArray,
            updatedAt: new Date()
        };

        let movie;
        const isValidId = id && id !== 'undefined' && id !== 'null' && id !== '';

        if (isValidId) {
            movie = await Movie.findByIdAndUpdate(
                id,
                movieData,
                { new: true, runValidators: true }
            );
            if (!movie) return res.status(404).json({ error: 'Movie not found for update' });
            console.log('✏️ Updated:', movie.title);
        } else {
            movie = new Movie(movieData);
            await movie.save();
            console.log('➕ Created:', movie.title);
        }

        res.json(movie);
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete movie
app.delete('/api/movies/:id', adminAuth, checkDB, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndDelete(req.params.id);
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        console.log('🗑️ Deleted:', movie.title);
        res.json({ message: 'Deleted successfully', title: movie.title });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Increment view count
app.post('/api/movies/:id/view', checkDB, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndUpdate(
            req.params.id,
            { $inc: { views: 1 } },
            { new: true }
        );
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        res.json({ views: movie.views });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Increment episode view
app.post('/api/movies/:movieId/episodes/:episodeId/view', checkDB, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.movieId);
        if (!movie) return res.status(404).json({ error: 'Movie not found' });

        const episode = movie.episodes.find(ep => ep.id === req.params.episodeId);
        if (!episode) return res.status(404).json({ error: 'Episode not found' });

        episode.views = (episode.views || 0) + 1;
        await movie.save();
        res.json({ views: episode.views });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Serve Pages ====================
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║         🎬 CineMax Server Started!               ║
╠══════════════════════════════════════════════════╣
║  URL:    http://localhost:${PORT}                 ║
║  Admin:  http://localhost:${PORT}/admin           ║
║  Health: http://localhost:${PORT}/api/health      ║
║  DB:     MongoDB Atlas (Cloud)                   ║
╚══════════════════════════════════════════════════╝
    `);
});
