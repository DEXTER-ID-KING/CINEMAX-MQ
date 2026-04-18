const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ==================== Middleware ====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '5000mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== MongoDB Connection ====================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://dexter:dexter4321@cluster0.ymfug48.mongodb.net/DEXTER_S?retryWrites=true&w=majority';

const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 30000,
            maxPoolSize: 10,
            family: 4, // Force IPv4 - fixes most local connection issues
        });
        console.log('✅ MongoDB Connected successfully to:', MONGODB_URI);
    } catch (err) {
        console.error('❌ MongoDB Connection error:', err.message);
        console.log('💡 Troubleshooting tips:');
        console.log('   1. Run: sudo systemctl start mongod');
        console.log('   2. Check: sudo systemctl status mongod');
        console.log('   3. Or use MongoDB Atlas cloud URI in .env');
        console.log('   Retrying in 5 seconds...');
        setTimeout(connectDB, 5000);
    }
};

connectDB();

mongoose.connection.on('connected', () => console.log('🔗 Mongoose connected'));
mongoose.connection.on('error', (err) => console.error('🔴 Mongoose error:', err));
mongoose.connection.on('disconnected', () => {
    console.log('🔌 Mongoose disconnected. Reconnecting...');
    setTimeout(connectDB, 3000);
});

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

// ==================== Admin Authentication ====================
const ADMIN_PIN = process.env.ADMIN_PIN || '200727';

const adminAuth = (req, res, next) => {
    const pin = req.headers['x-admin-pin'] || req.body?.pin;
    if (pin === ADMIN_PIN) return next();
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid admin PIN' });
};

// ==================== DB Status Check Middleware ====================
const checkDBConnection = (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
            error: 'Database not connected',
            message: 'MongoDB is not ready. Please wait or check server logs.',
            readyState: mongoose.connection.readyState
        });
    }
    next();
};

// ==================== API Routes ====================

// Health check
app.get('/api/health', (req, res) => {
    const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };
    res.json({
        status: 'ok',
        mongodb: states[mongoose.connection.readyState] || 'unknown',
        readyState: mongoose.connection.readyState,
        timestamp: new Date().toISOString()
    });
});

// Get all movies
app.get('/api/movies', checkDBConnection, async (req, res) => {
    try {
        const { type, trending, latest, search, limit } = req.query;
        let query = {};

        if (type) query.type = type;
        if (trending === 'true') query.isTrending = true;
        if (latest === 'true') query.isLatest = true;
        if (search) query.title = { $regex: search, $options: 'i' };

        const limitNum = parseInt(limit) || 100;
        const movies = await Movie.find(query)
            .sort({ createdAt: -1 })
            .limit(limitNum)
            .lean(); // lean() for better performance

        res.json(movies);
    } catch (error) {
        console.error('Error fetching movies:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single movie
app.get('/api/movies/:id', checkDBConnection, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id).lean();
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        res.json(movie);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create or Update movie
app.post('/api/movies', adminAuth, checkDBConnection, async (req, res) => {
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
            if (!movie) {
                return res.status(404).json({ error: 'Movie not found for update' });
            }
            console.log('✏️ Updated movie:', movie.title);
        } else {
            movie = new Movie(movieData);
            await movie.save();
            console.log('➕ Created movie:', movie.title);
        }

        res.json(movie);
    } catch (error) {
        console.error('Error saving movie:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete movie
app.delete('/api/movies/:id', adminAuth, checkDBConnection, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndDelete(req.params.id);
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        console.log('🗑️ Deleted movie:', movie.title);
        res.json({ message: 'Movie deleted successfully', title: movie.title });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Increment view count
app.post('/api/movies/:id/view', checkDBConnection, async (req, res) => {
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

// Increment episode view count
app.post('/api/movies/:movieId/episodes/:episodeId/view', checkDBConnection, async (req, res) => {
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

// ==================== Serve HTML Pages ====================
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
╔══════════════════════════════════════════════╗
║       🎬 CineMax Server Started 🎬           ║
╠══════════════════════════════════════════════╣
║  URL:    http://localhost:${PORT}              ║
║  Admin:  http://localhost:${PORT}/admin        ║
║  Health: http://localhost:${PORT}/api/health   ║
║  PIN:    ${ADMIN_PIN}                              ║
╚══════════════════════════════════════════════╝
    `);
});
