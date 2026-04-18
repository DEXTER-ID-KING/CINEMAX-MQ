const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();

// ==================== Middleware ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Google OAuth Client ====================
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '632556909730-ci1mdngs1jgla3fu7nj8jvfocmh84vcs.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ==================== PostgreSQL (Neon) Connection ====================
const DATABASE_URL = process.env.DATABASE_URL || 
    'postgresql://neondb_owner:npg_sSP2ILrA4TRB@ep-quiet-rain-ana555fb-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// Test connection
pool.query('SELECT NOW()')
    .then(res => {
        console.log('✅ PostgreSQL (Neon) Connected!');
        console.log('⏰ Server Time:', res.rows[0].now);
    })
    .catch(err => {
        console.error('❌ PostgreSQL Connection Error:', err.message);
    });

// ==================== Create Tables ====================
async function initDB() {
    try {
        // Movies table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS movies (
                id SERIAL PRIMARY KEY,
                title VARCHAR(500) NOT NULL,
                year INTEGER DEFAULT 2025,
                rating DECIMAL(3,1) DEFAULT 7.0,
                quality VARCHAR(20) DEFAULT 'HD',
                genre VARCHAR(300) DEFAULT '',
                language VARCHAR(100) DEFAULT 'English',
                type VARCHAR(10) DEFAULT 'movie' CHECK (type IN ('movie', 'tv')),
                is_trending BOOLEAN DEFAULT false,
                is_latest BOOLEAN DEFAULT false,
                poster_img TEXT DEFAULT '',
                video_url TEXT DEFAULT '',
                direct_link TEXT DEFAULT '',
                telegram_link TEXT DEFAULT '',
                drive_link TEXT DEFAULT '',
                description TEXT DEFAULT '',
                views INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Episodes table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS episodes (
                id SERIAL PRIMARY KEY,
                movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
                season INTEGER NOT NULL,
                episode INTEGER NOT NULL,
                title VARCHAR(500) DEFAULT '',
                quality VARCHAR(20) DEFAULT 'HD',
                video_url TEXT DEFAULT '',
                direct_link TEXT DEFAULT '',
                telegram_link TEXT DEFAULT '',
                drive_link TEXT DEFAULT '',
                views INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Users table for Google Auth
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                google_id VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                picture TEXT,
                last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Comments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS comments (
                id SERIAL PRIMARY KEY,
                movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                likes INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Comment likes table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS comment_likes (
                id SERIAL PRIMARY KEY,
                comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(comment_id, user_id)
            )
        `);

        // Indexes
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_movies_type ON movies(type)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_movies_trending ON movies(is_trending)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_movies_latest ON movies(is_latest)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_episodes_movie ON episodes(movie_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_movie ON comments(movie_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id)`);

        console.log('✅ Database tables ready!');
    } catch (err) {
        console.error('❌ DB Init Error:', err.message);
    }
}

initDB();

// ==================== Google Auth Verification ====================
async function verifyGoogleToken(token) {
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        return {
            googleId: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
            emailVerified: payload.email_verified
        };
    } catch (error) {
        console.error('Google token verification failed:', error.message);
        return null;
    }
}

// Auth middleware
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const userData = await verifyGoogleToken(token);
    
    if (!userData) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    // Find or create user
    try {
        let userResult = await pool.query(
            'SELECT * FROM users WHERE google_id = $1',
            [userData.googleId]
        );

        let user;
        if (userResult.rows.length === 0) {
            // Create new user
            const insertResult = await pool.query(
                `INSERT INTO users (google_id, email, name, picture, last_login) 
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
                 RETURNING id, google_id, email, name, picture, created_at`,
                [userData.googleId, userData.email, userData.name, userData.picture]
            );
            user = insertResult.rows[0];
            console.log('👤 New user created:', user.email);
        } else {
            // Update last login
            await pool.query(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
                [userResult.rows[0].id]
            );
            user = userResult.rows[0];
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

// Optional auth middleware (doesn't fail if no token)
async function optionalAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const userData = await verifyGoogleToken(token);
        if (userData) {
            const userResult = await pool.query(
                'SELECT * FROM users WHERE google_id = $1',
                [userData.googleId]
            );
            if (userResult.rows.length > 0) {
                req.user = userResult.rows[0];
            }
        }
    }
    next();
}

// ==================== Admin Auth ====================
const ADMIN_PIN = process.env.ADMIN_PIN || '200727';

const adminAuth = (req, res, next) => {
    const pin = req.headers['x-admin-pin'] || req.body?.pin;
    if (pin === ADMIN_PIN) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

// ==================== Helper: Get movie with episodes ====================
async function getMovieWithEpisodes(movieId) {
    const movieResult = await pool.query('SELECT * FROM movies WHERE id = $1', [movieId]);
    if (movieResult.rows.length === 0) return null;

    const movie = movieResult.rows[0];

    const episodesResult = await pool.query(
        'SELECT * FROM episodes WHERE movie_id = $1 ORDER BY season, episode',
        [movieId]
    );

    // Format to camelCase for frontend
    return {
        _id: movie.id.toString(),
        title: movie.title,
        year: movie.year,
        rating: parseFloat(movie.rating),
        quality: movie.quality,
        genre: movie.genre,
        language: movie.language,
        type: movie.type,
        isTrending: movie.is_trending,
        isLatest: movie.is_latest,
        posterImg: movie.poster_img,
        videoUrl: movie.video_url,
        directLink: movie.direct_link,
        telegramLink: movie.telegram_link,
        driveLink: movie.drive_link,
        description: movie.description,
        views: movie.views,
        createdAt: movie.created_at,
        updatedAt: movie.updated_at,
        episodes: episodesResult.rows.map(ep => ({
            id: ep.id.toString(),
            movieId: ep.movie_id,
            season: ep.season,
            episode: ep.episode,
            title: ep.title,
            quality: ep.quality,
            videoUrl: ep.video_url,
            directLink: ep.direct_link,
            telegramLink: ep.telegram_link,
            driveLink: ep.drive_link,
            views: ep.views,
            createdAt: ep.created_at
        }))
    };
}

// ==================== API Routes ====================

// Google Auth endpoint
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'No token provided' });
        }

        const userData = await verifyGoogleToken(token);
        
        if (!userData) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Find or create user
        let userResult = await pool.query(
            'SELECT * FROM users WHERE google_id = $1',
            [userData.googleId]
        );

        let user;
        if (userResult.rows.length === 0) {
            const insertResult = await pool.query(
                `INSERT INTO users (google_id, email, name, picture, last_login) 
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
                 RETURNING id, google_id, email, name, picture, created_at`,
                [userData.googleId, userData.email, userData.name, userData.picture]
            );
            user = insertResult.rows[0];
            console.log('👤 New user registered:', user.email);
        } else {
            await pool.query(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
                [userResult.rows[0].id]
            );
            user = userResult.rows[0];
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                picture: user.picture
            }
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({
        user: {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
            picture: req.user.picture
        }
    });
});

// Health Check
app.get('/api/health', async (req, res) => {
    try {
        const dbCheck = await pool.query('SELECT NOW() as time, current_database() as db');
        const countResult = await pool.query('SELECT COUNT(*) as count FROM movies');

        res.json({
            status: 'ok',
            database: 'PostgreSQL (Neon)',
            dbName: dbCheck.rows[0].db,
            serverTime: dbCheck.rows[0].time,
            moviesCount: parseInt(countResult.rows[0].count),
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.json({
            status: 'error',
            database: 'PostgreSQL (Neon)',
            error: err.message
        });
    }
});

// Get all movies
app.get('/api/movies', async (req, res) => {
    try {
        const { type, trending, latest, search, limit } = req.query;

        let query = 'SELECT * FROM movies WHERE 1=1';
        let params = [];
        let paramIndex = 1;

        if (type) {
            query += ` AND type = $${paramIndex++}`;
            params.push(type);
        }
        if (trending === 'true') {
            query += ' AND is_trending = true';
        }
        if (latest === 'true') {
            query += ' AND is_latest = true';
        }
        if (search) {
            query += ` AND (LOWER(title) LIKE $${paramIndex++} OR LOWER(genre) LIKE $${paramIndex++})`;
            const searchTerm = `%${search.toLowerCase()}%`;
            params.push(searchTerm, searchTerm);
        }

        query += ' ORDER BY created_at DESC';

        if (limit) {
            query += ` LIMIT $${paramIndex++}`;
            params.push(parseInt(limit));
        }

        const result = await pool.query(query, params);

        // Get episodes for each movie
        const movies = [];
        for (const movie of result.rows) {
            const formatted = await getMovieWithEpisodes(movie.id);
            if (formatted) movies.push(formatted);
        }

        res.json(movies);
    } catch (error) {
        console.error('Error fetching movies:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single movie
app.get('/api/movies/:id', async (req, res) => {
    try {
        const movie = await getMovieWithEpisodes(parseInt(req.params.id));
        if (!movie) return res.status(404).json({ error: 'Movie not found' });
        res.json(movie);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create or Update movie
app.post('/api/movies', adminAuth, async (req, res) => {
    try {
        const {
            id, title, year, rating, quality, genre, language, type,
            isTrending, isLatest, posterImg, videoUrl, directLink,
            telegramLink, driveLink, description, episodes
        } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }

        let episodesArray = [];
        if (episodes) {
            episodesArray = typeof episodes === 'string' ? JSON.parse(episodes) : episodes;
        }

        const isValidId = id && id !== 'undefined' && id !== 'null' && id !== '';

        let movieId;

        if (isValidId) {
            // Update existing movie
            const updateResult = await pool.query(`
                UPDATE movies SET
                    title = $1, year = $2, rating = $3, quality = $4,
                    genre = $5, language = $6, type = $7,
                    is_trending = $8, is_latest = $9,
                    poster_img = $10, video_url = $11, direct_link = $12,
                    telegram_link = $13, drive_link = $14,
                    description = $15, updated_at = CURRENT_TIMESTAMP
                WHERE id = $16
                RETURNING id
            `, [
                title.trim(),
                parseInt(year) || 2025,
                parseFloat(rating) || 7.0,
                quality || 'HD',
                genre || '',
                language || 'English',
                type || 'movie',
                isTrending === true || isTrending === 'true',
                isLatest === true || isLatest === 'true',
                posterImg || '',
                videoUrl || '',
                directLink || videoUrl || '',
                telegramLink || '',
                driveLink || '',
                description || '',
                parseInt(id)
            ]);

            if (updateResult.rows.length === 0) {
                return res.status(404).json({ error: 'Movie not found' });
            }

            movieId = updateResult.rows[0].id;

            // Delete old episodes and re-insert
            await pool.query('DELETE FROM episodes WHERE movie_id = $1', [movieId]);

            console.log('✏️ Updated:', title);
        } else {
            // Create new movie
            const insertResult = await pool.query(`
                INSERT INTO movies (
                    title, year, rating, quality, genre, language, type,
                    is_trending, is_latest, poster_img, video_url, direct_link,
                    telegram_link, drive_link, description
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                RETURNING id
            `, [
                title.trim(),
                parseInt(year) || 2025,
                parseFloat(rating) || 7.0,
                quality || 'HD',
                genre || '',
                language || 'English',
                type || 'movie',
                isTrending === true || isTrending === 'true',
                isLatest === true || isLatest === 'true',
                posterImg || '',
                videoUrl || '',
                directLink || videoUrl || '',
                telegramLink || '',
                driveLink || '',
                description || ''
            ]);

            movieId = insertResult.rows[0].id;
            console.log('➕ Created:', title, '(ID:', movieId, ')');
        }

        // Insert episodes
        if (episodesArray.length > 0) {
            for (const ep of episodesArray) {
                await pool.query(`
                    INSERT INTO episodes (
                        movie_id, season, episode, title, quality,
                        video_url, direct_link, telegram_link, drive_link
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                `, [
                    movieId,
                    parseInt(ep.season) || 1,
                    parseInt(ep.episode) || 1,
                    ep.title || `Episode ${ep.episode}`,
                    ep.quality || 'HD',
                    ep.videoUrl || '',
                    ep.directLink || ep.videoUrl || '',
                    ep.telegramLink || '',
                    ep.driveLink || ''
                ]);
            }
            console.log(`   📺 ${episodesArray.length} episodes saved`);
        }

        // Return full movie with episodes
        const movie = await getMovieWithEpisodes(movieId);
        res.json(movie);

    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete movie
app.delete('/api/movies/:id', adminAuth, async (req, res) => {
    try {
        const movieId = parseInt(req.params.id);

        // Get movie title before delete
        const movie = await pool.query('SELECT title FROM movies WHERE id = $1', [movieId]);
        if (movie.rows.length === 0) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        const title = movie.rows[0].title;

        // Delete (episodes auto-deleted via CASCADE)
        await pool.query('DELETE FROM movies WHERE id = $1', [movieId]);

        console.log('🗑️ Deleted:', title);
        res.json({ message: 'Deleted successfully', title });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Increment movie views
app.post('/api/movies/:id/view', async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE movies SET views = views + 1 WHERE id = $1 RETURNING views',
            [parseInt(req.params.id)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ views: result.rows[0].views });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Increment episode views
app.post('/api/movies/:movieId/episodes/:episodeId/view', async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE episodes SET views = views + 1 WHERE id = $1 AND movie_id = $2 RETURNING views',
            [parseInt(req.params.episodeId), parseInt(req.params.movieId)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ views: result.rows[0].views });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== Comments API ====================

// Get comments for a movie
app.get('/api/movies/:id/comments', optionalAuthMiddleware, async (req, res) => {
    try {
        const movieId = parseInt(req.params.id);
        
        const result = await pool.query(`
            SELECT 
                c.id,
                c.text,
                c.likes,
                c.created_at,
                c.parent_id,
                u.id as user_id,
                u.name as user_name,
                u.picture as user_picture,
                CASE WHEN $2::integer IS NOT NULL THEN 
                    (SELECT COUNT(*) > 0 FROM comment_likes cl 
                     WHERE cl.comment_id = c.id AND cl.user_id = $2)
                ELSE false END as liked_by_user
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.movie_id = $1
            ORDER BY c.created_at DESC
        `, [movieId, req.user?.id || null]);

        // Organize comments with replies
        const comments = [];
        const commentMap = new Map();
        
        result.rows.forEach(row => {
            const comment = {
                id: row.id.toString(),
                text: row.text,
                likes: row.likes,
                createdAt: row.created_at,
                parentId: row.parent_id ? row.parent_id.toString() : null,
                user: {
                    id: row.user_id,
                    name: row.user_name,
                    picture: row.user_picture
                },
                likedByUser: row.liked_by_user,
                replies: []
            };
            commentMap.set(comment.id, comment);
            
            if (!comment.parentId) {
                comments.push(comment);
            }
        });
        
        // Add replies to parent comments
        result.rows.forEach(row => {
            if (row.parent_id) {
                const parent = commentMap.get(row.parent_id.toString());
                const child = commentMap.get(row.id.toString());
                if (parent && child) {
                    parent.replies.push(child);
                }
            }
        });

        res.json(comments);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add comment
app.post('/api/movies/:id/comments', authMiddleware, async (req, res) => {
    try {
        const movieId = parseInt(req.params.id);
        const { text, parentId } = req.body;
        const userId = req.user.id;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        const result = await pool.query(`
            INSERT INTO comments (movie_id, user_id, parent_id, text)
            VALUES ($1, $2, $3, $4)
            RETURNING id, text, created_at, parent_id
        `, [movieId, userId, parentId ? parseInt(parentId) : null, text.trim()]);

        const comment = result.rows[0];

        // Get user info
        const userResult = await pool.query(
            'SELECT id, name, picture FROM users WHERE id = $1',
            [userId]
        );

        res.json({
            id: comment.id.toString(),
            text: comment.text,
            likes: 0,
            createdAt: comment.created_at,
            parentId: comment.parent_id ? comment.parent_id.toString() : null,
            user: {
                id: userResult.rows[0].id,
                name: userResult.rows[0].name,
                picture: userResult.rows[0].picture
            },
            likedByUser: false,
            replies: []
        });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: error.message });
    }
});

// Like/Unlike comment
app.post('/api/comments/:id/like', authMiddleware, async (req, res) => {
    try {
        const commentId = parseInt(req.params.id);
        const userId = req.user.id;

        // Check if already liked
        const existing = await pool.query(
            'SELECT * FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
            [commentId, userId]
        );

        if (existing.rows.length > 0) {
            // Unlike
            await pool.query(
                'DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
                [commentId, userId]
            );
            await pool.query(
                'UPDATE comments SET likes = likes - 1 WHERE id = $1',
                [commentId]
            );
        } else {
            // Like
            await pool.query(
                'INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)',
                [commentId, userId]
            );
            await pool.query(
                'UPDATE comments SET likes = likes + 1 WHERE id = $1',
                [commentId]
            );
        }

        const result = await pool.query(
            'SELECT likes FROM comments WHERE id = $1',
            [commentId]
        );

        res.json({
            liked: existing.rows.length === 0,
            likes: result.rows[0].likes
        });
    } catch (error) {
        console.error('Error liking comment:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete comment
app.delete('/api/comments/:id', authMiddleware, async (req, res) => {
    try {
        const commentId = parseInt(req.params.id);
        const userId = req.user.id;

        // Check if user owns the comment
        const comment = await pool.query(
            'SELECT user_id FROM comments WHERE id = $1',
            [commentId]
        );

        if (comment.rows.length === 0) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        if (comment.rows[0].user_id !== userId) {
            return res.status(403).json({ error: 'Not authorized to delete this comment' });
        }

        await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);

        res.json({ message: 'Comment deleted' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: error.message });
    }
});

// Search movies
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const result = await pool.query(`
            SELECT * FROM movies
            WHERE LOWER(title) LIKE $1
               OR LOWER(genre) LIKE $1
               OR LOWER(description) LIKE $1
            ORDER BY views DESC, created_at DESC
            LIMIT 20
        `, [`%${q.toLowerCase()}%`]);

        const movies = [];
        for (const row of result.rows) {
            const formatted = await getMovieWithEpisodes(row.id);
            if (formatted) movies.push(formatted);
        }

        res.json(movies);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Stats
app.get('/api/stats', adminAuth, async (req, res) => {
    try {
        const totalMovies = await pool.query("SELECT COUNT(*) FROM movies WHERE type = 'movie'");
        const totalTV = await pool.query("SELECT COUNT(*) FROM movies WHERE type = 'tv'");
        const totalEpisodes = await pool.query('SELECT COUNT(*) FROM episodes');
        const totalViews = await pool.query('SELECT COALESCE(SUM(views), 0) as total FROM movies');
        const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
        const totalComments = await pool.query('SELECT COUNT(*) FROM comments');
        const topMovies = await pool.query('SELECT title, views FROM movies ORDER BY views DESC LIMIT 5');

        res.json({
            movies: parseInt(totalMovies.rows[0].count),
            tvShows: parseInt(totalTV.rows[0].count),
            episodes: parseInt(totalEpisodes.rows[0].count),
            totalViews: parseInt(totalViews.rows[0].total),
            users: parseInt(totalUsers.rows[0].count),
            comments: parseInt(totalComments.rows[0].count),
            topContent: topMovies.rows
        });
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
╔═══════════════════════════════════════════════╗
║       🎬 CineMax Server Running!              ║
╠═══════════════════════════════════════════════╣
║  URL:    http://localhost:${PORT}              ║
║  Admin:  http://localhost:${PORT}/admin        ║
║  DB:     PostgreSQL (Neon Cloud)              ║
║  Mode:   Direct Links (No file upload)        ║
║  Auth:   Google OAuth 2.0                     ║
╚═══════════════════════════════════════════════╝
    `);
});
