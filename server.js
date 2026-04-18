const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config();

const app = express();

// ==================== Middleware ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// ==================== MongoDB Connection ====================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cinemax';
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected successfully'))
  .catch(err => console.error('❌ MongoDB Connection error:', err));

// ==================== Movie Schema ====================
const EpisodeSchema = new mongoose.Schema({
    id: { type: String, default: () => Date.now().toString() },
    season: { type: Number, required: true },
    episode: { type: Number, required: true },
    title: String,
    quality: { type: String, default: 'HD' },
    videoBlobId: String,
    videoUrl: String,
    qualityUrls: {
        240: String,
        360: String,
        480: String,
        720: String,
        1080: String
    },
    directLink: String,
    telegramLink: String,
    driveLink: String,
    gofileFileId: String,
    gofileDirectLink: String,
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const MovieSchema = new mongoose.Schema({
    title: { type: String, required: true },
    year: Number,
    rating: { type: Number, default: 7.0 },
    quality: { type: String, default: 'HD' },
    genre: String,
    language: String,
    type: { type: String, enum: ['movie', 'tv'], default: 'movie' },
    isTrending: { type: Boolean, default: false },
    isLatest: { type: Boolean, default: false },
    posterImg: String,
    thumbnailId: String,
    videoBlobId: String,
    videoUrl: String,
    qualityUrls: {
        240: String,
        360: String,
        480: String,
        720: String,
        1080: String
    },
    directLink: String,
    telegramLink: String,
    driveLink: String,
    gofileFolderId: String,
    gofileFileId: String,
    gofileDirectLink: String,
    description: String,
    views: { type: Number, default: 0 },
    episodes: [EpisodeSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Movie = mongoose.model('Movie', MovieSchema);

// ==================== Gofile Configuration ====================
const GOFILE_TOKEN = 'HclcFt3HtFkW3mC2fGS9UjgqUb8Z0dC1';
const GOFILE_ACCOUNT_ID = 'aaebd426-43c8-49b4-ac07-3f802ae7bb74';

// Gofile API Helper
const gofileRequest = async (method, endpoint, data = null, isUpload = false) => {
    try {
        const config = {
            method,
            url: isUpload ? `https://upload.gofile.io${endpoint}` : `https://api.gofile.io${endpoint}`,
            headers: {
                'Authorization': `Bearer ${GOFILE_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };
        if (data && !isUpload) config.data = data;
        const response = await axios(config);
        if (response.data.status === 'ok') return response.data.data;
        throw new Error(response.data.status);
    } catch (error) {
        console.error('Gofile API Error:', error.response?.data || error.message);
        throw error;
    }
};

// Create folder in Gofile
const createGofileFolder = async (folderName) => {
    try {
        const result = await gofileRequest('POST', '/contents/createFolder', {
            parentFolderId: 'root',
            folderName: folderName,
            public: true
        });
        return result;
    } catch (error) {
        console.error('Create folder error:', error);
        return null;
    }
};

// Get direct link for content
const getDirectLink = async (contentId) => {
    try {
        const result = await gofileRequest('POST', `/contents/${contentId}/directlinks`, {
            expireTime: null,
            domainsAllowed: ['*']
        });
        return result;
    } catch (error) {
        console.error('Get direct link error:', error);
        return null;
    }
};

// ==================== Multer Setup for Thumbnails ====================
// Create uploads folder if not exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage, 
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for thumbnails
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed'));
    }
});

// ==================== Admin Authentication ====================
const ADMIN_PIN = '200727';

const adminAuth = (req, res, next) => {
    const pin = req.headers['x-admin-pin'] || req.body.pin;
    if (pin === ADMIN_PIN) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid admin PIN' });
};

// ==================== API Routes ====================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Get all movies (public)
app.get('/api/movies', async (req, res) => {
    try {
        const movies = await Movie.find().sort({ createdAt: -1 });
        res.json(movies);
    } catch (error) {
        console.error('Error fetching movies:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single movie by ID (public)
app.get('/api/movies/:id', async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        res.json(movie);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create or Update movie (admin only)
app.post('/api/movies', adminAuth, upload.single('thumbnail'), async (req, res) => {
    try {
        const { 
            id, title, year, rating, quality, genre, language, type,
            isTrending, isLatest, posterImg, directLink, telegramLink, 
            driveLink, description, videoUrl, episodes, gofileFolderId,
            gofileFileId, gofileDirectLink
        } = req.body;
        
        let thumbnailUrl = posterImg;
        
        // Upload thumbnail if provided
        if (req.file) {
            thumbnailUrl = `/uploads/${req.file.filename}`;
        }
        
        let episodesArray = [];
        if (episodes) {
            try {
                episodesArray = typeof episodes === 'string' ? JSON.parse(episodes) : episodes;
            } catch(e) {
                episodesArray = [];
            }
        }
        
        const movieData = {
            title,
            year: parseInt(year) || 2025,
            rating: parseFloat(rating) || 7.0,
            quality: quality || 'HD',
            genre: genre || '',
            language: language || 'English',
            type: type || 'movie',
            isTrending: isTrending === 'true' || isTrending === true,
            isLatest: isLatest === 'true' || isLatest === true,
            posterImg: thumbnailUrl,
            directLink: directLink || '',
            telegramLink: telegramLink || '',
            driveLink: driveLink || '',
            videoUrl: videoUrl || '',
            description: description || '',
            gofileFolderId: gofileFolderId || '',
            gofileFileId: gofileFileId || '',
            gofileDirectLink: gofileDirectLink || '',
            episodes: episodesArray,
            updatedAt: new Date()
        };
        
        let movie;
        if (id && id !== 'undefined' && id !== 'null') {
            // Update existing movie
            movie = await Movie.findByIdAndUpdate(id, movieData, { new: true, runValidators: true });
            if (!movie) {
                return res.status(404).json({ error: 'Movie not found' });
            }
        } else {
            // Create new movie
            movie = new Movie(movieData);
            await movie.save();
        }
        
        res.json(movie);
    } catch (error) {
        console.error('Error saving movie:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete movie (admin only)
app.delete('/api/movies/:id', adminAuth, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndDelete(req.params.id);
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        res.json({ message: 'Movie deleted successfully', id: req.params.id });
    } catch (error) {
        console.error('Error deleting movie:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete episode (admin only)
app.delete('/api/movies/:movieId/episodes/:episodeId', adminAuth, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.movieId);
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        
        const episodeIndex = movie.episodes.findIndex(ep => ep.id === req.params.episodeId);
        if (episodeIndex === -1) {
            return res.status(404).json({ error: 'Episode not found' });
        }
        
        movie.episodes.splice(episodeIndex, 1);
        await movie.save();
        
        res.json({ message: 'Episode deleted successfully', movie });
    } catch (error) {
        console.error('Error deleting episode:', error);
        res.status(500).json({ error: error.message });
    }
});

// Increment view count (public)
app.post('/api/movies/:id/view', async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        
        movie.views = (movie.views || 0) + 1;
        await movie.save();
        
        res.json({ views: movie.views });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Increment episode view count (public)
app.post('/api/movies/:movieId/episodes/:episodeId/view', async (req, res) => {
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

// Create Gofile folder for movie (admin only)
app.post('/api/movies/:id/gofile-folder', adminAuth, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        
        const folder = await createGofileFolder(movie.title);
        if (folder) {
            movie.gofileFolderId = folder.folderId;
            await movie.save();
            res.json({ folderId: folder.folderId, folder });
        } else {
            res.status(500).json({ error: 'Failed to create Gofile folder' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Serve HTML Pages ====================
// Serve admin.html with PIN protection middleware
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve index.html as default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for SPA routing - serve index.html for unknown routes (except API)
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// ==================== Error Handling Middleware ====================
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Multer error: ${err.message}` });
    }
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════════╗
    ║         🎬 CineMax Server Started 🎬             ║
    ╠══════════════════════════════════════════════════╣
    ║  Server URL: http://localhost:${PORT}             ║
    ║  Admin Panel: http://localhost:${PORT}/admin      ║
    ║  Admin PIN: 200727                               ║
    ║  MongoDB: ${MONGODB_URI}      ║
    ╚══════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    process.exit(0);
});
