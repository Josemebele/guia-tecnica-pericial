const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken'); // Preparado para sesiones seguras si decides usarlas
const path = require('path');
require('dotenv').config();

const comprobantesRouter = require('./routes/comprobantes');
const consultasRouter   = require('./routes/consultas');
const Inscripcion = require('./models/Inscripcion');

const app = express();

/* =================================
   Base: proxy, CORS, parsers, estáticos
================================= */
// Confía en el proxy (Render) para detectar https correctamente
app.set('trust proxy', 1);

// CORS abierto (útil en local y simple en prod si front/back mismo dominio)
app.use(cors());

// Parseo de JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // útil para <form> application/x-www-form-urlencoded

// Archivos estáticos (gracias.html, verificado.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck para diagnósticos rápidos
app.get('/health', (req, res) => res.status(200).send('OK'));

/* =================================
   Rutas de la app
================================= */
app.use('/', comprobantesRouter);
app.use('/', consultasRouter);

/* =================================
   Conexión a MongoDB
================================= */
mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.error('❌ Error de conexión:', err));

/* =================================
   Transporter SMTP (Yahoo/Gmail/otro)
================================= */
// Usa siempre SMTP por variables de entorno.
// Para Yahoo: host=smtp.mail.yahoo.com / port=587 / user=correo@yahoo.es / pass=APP_PASSWORD (sin espacios)
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,                            // p.ej. smtp.mail.yahoo.com
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,                                          // true si usas 465
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  // opcional:
  // tls: { rejectUnauthorized: false }
});

/* =================================
   Registro (envío de verificación)
================================= */
app.post('/send', async (req, res) => {
  const { nombre, apellido, correo, contrasena, direccion, ciudad, cp, pais } = req.body;

  if (!nombre || !apellido || !correo || !contrasena || !direccion || !ciudad || !cp || !pais) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    const existente = await Inscripcion.findOne({ correo });
    if (existente) {
      return res.status(400).json({ error: 'Este correo ya está registrado.' });
    }

    const hashedPass = await bcrypt.hash(contrasena, 10);
    const token = crypto.randomBytes(32).toString('hex');

    const nuevaInscripcion = new Inscripcion({
      nombre,
      apellido,
      correo,
      contrasena: hashedPass,
      direccion,
      ciudad,
      cp,
      pais,
      token
    });

    await nuevaInscripcion.save();

    // Construcción robusta de la URL base
    const envBase = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/+$/, '') : null;
    const proto   = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host    = req.get('host');
    const base    = envBase || `${proto}://${host}`;

    const link = `${base}/verificar?token=${token}`;

    await mailTransporter.sendMail({
      from: `"Guía Técnica Pericial" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to: correo,
      subject: 'Verifica tu correo',
      html: `
        <h3>Hola ${nombre} ${apellido},</h3>
        <p>Gracias por tu interés. Haz clic en el siguiente enlace para verificar tu correo:</p>
        <a href="${link}">${link}</a>
        <br><br><small>Este mensaje es automático, por favor no respondas.</small>
      `
    });

    res.status(200).json({ message: 'Correo de verificación enviado correctamente.' });

  } catch (err) {
    console.error('Error al registrar usuario:', err);
    res.status(500).json({ error: 'Error en el servidor al guardar o enviar el correo.' });
  }
});

/* =================================
   Verificación de email
================================= */
app.get('/verificar', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Token inválido.');

  try {
    const usuario = await Inscripcion.findOne({ token });
    if (!usuario) return res.status(404).send('Token no encontrado o expirado.');

    usuario.verificado = true;
    usuario.token = undefined;
    await usuario.save();

    res.redirect('/verificado.html');
  } catch (err) {
    console.error('Error en la verificación:', err);
    res.status(500).send('Error al verificar el correo.');
  }
});

/* =================================
   Login
================================= */
app.post('/login', async (req, res) => {
  const { correo, contrasena } = req.body;

  if (!correo || !contrasena) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    const usuario = await Inscripcion.findOne({ correo });
    if (!usuario) {
      return res.status(400).json({ error: 'Usuario no encontrado.' });
    }

    const coincide = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!coincide) {
      return res.status(400).json({ error: 'Contraseña incorrecta.' });
    }

    if (!usuario.verificado) {
      return res.status(403).json({ error: 'Debes verificar tu correo antes de iniciar sesión.' });
    }

    res.status(200).json({
      message: 'Inicio de sesión exitoso',
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      correo: usuario.correo
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

/* =================================
   Middleware de errores Multer
================================= */
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('Archivo demasiado grande.');
  }
  if (err && err.message?.includes('Formato no permitido')) {
    return res.status(400).send('Formato no permitido. Sube PDF, imagen o TXT.');
  }
  console.error('❌ Error global:', err);
  next(err);
});

/* =================================
   Arranque del servidor
================================= */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('🚀 Servidor backend corriendo en http://localhost:' + PORT);
});