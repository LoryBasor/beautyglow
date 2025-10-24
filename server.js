// server.js
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));

// Configuration MySQL
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.MYSQL_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Configuration Multer pour upload d'images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Seules les images sont autorisées!'));
  }
});

// Créer la connexion à la base de données
let pool;

async function initDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    
    // Créer la table products si elle n'existe pas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        price VARCHAR(100) NOT NULL,
        icon VARCHAR(10),
        image VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Créer la table admin si elle n'existe pas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);

    // Insérer un admin par défaut (mot de passe: admin123)
    await pool.query(`
      INSERT IGNORE INTO admin (username, password) 
      VALUES ('admin', 'admin123')
    `);

    console.log('✅ Base de données initialisée avec succès');
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation de la base de données:', error);
    process.exit(1);
  }
}

// Routes API

// GET - Récupérer tous les produits
app.get('/api/products', async (req, res) => {
  try {
    const [products] = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json({ success: true, products });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET - Récupérer un produit par ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const [products] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (products.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }
    res.json({ success: true, product: products[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST - Ajouter un produit
app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, icon } = req.body;
    
    if (!name || !description || !price) {
      return res.status(400).json({ success: false, message: 'Tous les champs requis doivent être remplis' });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const [result] = await pool.query(
      'INSERT INTO products (name, description, price, icon, image) VALUES (?, ?, ?, ?, ?)',
      [name, description, price, icon || null, imagePath]
    );

    const [newProduct] = await pool.query('SELECT * FROM products WHERE id = ?', [result.insertId]);

    res.json({ success: true, message: 'Produit ajouté avec succès', product: newProduct[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'ajout du produit' });
  }
});

// PUT - Modifier un produit
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, icon } = req.body;
    const productId = req.params.id;

    // Vérifier si le produit existe
    const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }

    let imagePath = existing[0].image;

    // Si une nouvelle image est uploadée
    if (req.file) {
      // Supprimer l'ancienne image
      if (existing[0].image) {
        const oldImagePath = path.join(__dirname, existing[0].image);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      imagePath = `/uploads/${req.file.filename}`;
    }

    await pool.query(
      'UPDATE products SET name = ?, description = ?, price = ?, icon = ?, image = ? WHERE id = ?',
      [name, description, price, icon || null, imagePath, productId]
    );

    const [updatedProduct] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);

    res.json({ success: true, message: 'Produit modifié avec succès', product: updatedProduct[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur lors de la modification du produit' });
  }
});

// DELETE - Supprimer un produit
app.delete('/api/products/:id', async (req, res) => {
  try {
    const productId = req.params.id;

    // Récupérer le produit pour supprimer l'image
    const [product] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);
    
    if (product.length === 0) {
      return res.status(404).json({ success: false, message: 'Produit non trouvé' });
    }

    // Supprimer l'image du serveur
    if (product[0].image) {
      const imagePath = path.join(__dirname, product[0].image);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    await pool.query('DELETE FROM products WHERE id = ?', [productId]);

    res.json({ success: true, message: 'Produit supprimé avec succès' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression du produit' });
  }
});

// POST - Login admin
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [admin] = await pool.query(
      'SELECT * FROM admin WHERE username = ? AND password = ?',
      [username, password]
    );

    if (admin.length === 0) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    res.json({ success: true, message: 'Connexion réussie' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Route pour servir le frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialiser la base de données et démarrer le serveur
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur le port ${PORT}`);
    console.log(`📱 Application accessible sur http://localhost:${PORT}`);
  });
});

// Gestion des erreurs
process.on('unhandledRejection', (error) => {
  console.error('Erreur non gérée:', error);
});
