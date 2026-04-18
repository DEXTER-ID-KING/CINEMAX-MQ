const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// ==================== Middleware ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== MongoDB Connection ====================
const MONGODB_URI = 'mongodb://localhost:27017/cinemax';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected successfully'))
    .catch(err => {
        console.error('❌ MongoDB Connection error:', err);
        console.log('Please make sure MongoDB is running: sudo systemctl start mongod');
        process.exit(1);
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
    description: String,
    views: { type: Number, default: 0 },
    episodes: [EpisodeSchema],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Movie = mongoose.model('Movie', MovieSchema);

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

// Get all movies
app.get('/api/movies', async (req, res) => {
    try {
        const movies = await Movie.find().sort({ createdAt: -1 });
        res.json(movies);
    } catch (error) {
        console.error('Error fetching movies:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single movie
app.get('/api/movies/:id', async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        res.json(movie);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create or Update movie
app.post('/api/movies', adminAuth, async (req, res) => {
    try {
        const { id, title, year, rating, quality, genre, language, type,
            isTrending, isLatest, posterImg, videoUrl, directLink, 
            telegramLink, driveLink, description, episodes } = req.body;
        
        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }
        
        let episodesArray = [];
        if (episodes) {
            episodesArray = typeof episodes === 'string' ? JSON.parse(episodes) : episodes;
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
            posterImg: posterImg || '',
            videoUrl: videoUrl || '',
            directLink: directLink || videoUrl || '',
            telegramLink: telegramLink || '',
            driveLink: driveLink || '',
            description: description || '',
            episodes: episodesArray,
            updatedAt: new Date()
        };
        
        let movie;
        if (id && id !== 'undefined' && id !== 'null') {
            movie = await Movie.findByIdAndUpdate(id, movieData, { new: true, runValidators: true });
            if (!movie) {
                return res.status(404).json({ error: 'Movie not found' });
            }
        } else {
            movie = new Movie(movieData);
            await movie.save();
        }
        
        res.json(movie);
    } catch (error) {
        console.error('Error saving movie:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete movie
app.delete('/api/movies/:id', adminAuth, async (req, res) => {
    try {
        const movie = await Movie.findByIdAndDelete(req.params.id);
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }
        res.json({ message: 'Movie deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Increment view count
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

// Increment episode view count
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

// ==================== Serve HTML Pages ====================
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    ║  MongoDB: ${MONGODB_URI}                         ║
    ╚══════════════════════════════════════════════════╝
    `);
});
