const express = require('express');
const router = express.Router();
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Config
const MAX_FREE_CHARS = Number(process.env.MAX_FREE_CHARS || 500);
const MAX_FILE_SIZE_MB = 10;

// Subida de adjuntos para consulta de pago (opcional)
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/png','image/jpeg','image/jpg',
      'text/plain'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato no permitido. Sube PDF, imagen o TXT.'));
  }
});

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
const isEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// 1) Consulta gratuita (corta, sin adjuntos)
router.post('/consultas/gratis', express.urlencoded({ extended: true }), (req, res) => {
  const { nombre, correo, asunto, mensaje } = req.body;

  if (!nombre || !correo || !mensaje) {
    return res.status(400).send('Faltan datos.');
  }
  if (!isEmail(correo)) return res.status(400).send('Correo inválido.');
  if (mensaje.length > MAX_FREE_CHARS) {
    return res.status(400).send(`La consulta gratuita admite hasta ${MAX_FREE_CHARS} caracteres.`);
  }

  // Redirige ya
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const redirectTo = base ? `${base}/gracias.html` : '/gracias.html';
  res.redirect(redirectTo);

  const transporter = createTransporter();

  // Email al admin
  const htmlAdmin = `
    <h3>Consulta GRATUITA recibida</h3>
    <p><b>Nombre:</b> ${nombre}</p>
    <p><b>Correo:</b> ${correo}</p>
    ${asunto ? `<p><b>Asunto:</b> ${asunto}</p>` : ''}
    <p><b>Mensaje:</b><br>${mensaje.replace(/\n/g,'<br>')}</p>
  `;

  // Email al usuario (confirmación)
  const htmlUser = `
    <h2>¡Gracias, ${nombre}!</h2>
    <p>Hemos recibido tu consulta gratuita. En breve te responderemos.</p>
    ${asunto ? `<p><b>Asunto:</b> ${asunto}</p>` : ''}
    <p><b>Tu consulta:</b><br>${mensaje.replace(/\n/g,'<br>')}</p>
  `;

  Promise.allSettled([
    transporter.sendMail({
      from: `"Consultas" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `Consulta GRATUITA - ${nombre}${asunto ? ' - ' + asunto : ''}`,
      html: htmlAdmin
    }),
    transporter.sendMail({
      from: `"Guía Técnica Pericial" <${process.env.SMTP_USER}>`,
      to: correo,
      subject: 'Hemos recibido tu consulta gratuita',
      html: htmlUser
    })
  ]).then(([a,u]) => {
    if (a.status === 'rejected') console.error('Admin mail error:', a.reason);
    if (u.status === 'rejected') console.error('User mail error:', u.reason);
  }).catch(err => console.error('Mail error:', err));
});

// 2) Consulta de pago (presupuesto), con adjunto opcional
router.post('/consultas/presupuesto', upload.single('adjunto'), (req, res) => {
  const { nombre, correo, asunto, descripcion } = req.body;
  const adj = req.file;

  if (!nombre || !correo || !descripcion) {
    if (adj?.path) try { fs.unlinkSync(adj.path); } catch {}
    return res.status(400).send('Faltan datos.');
  }
  if (!isEmail(correo)) {
    if (adj?.path) try { fs.unlinkSync(adj.path); } catch {}
    return res.status(400).send('Correo inválido.');
  }

  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const redirectTo = base ? `${base}/gracias.html` : '/gracias.html';
  res.redirect(redirectTo);

  const transporter = createTransporter();

  // Email al admin (adjunto si existe)
  const htmlAdmin = `
    <h3>Consulta de PAGO (para PRESUPUESTO)</h3>
    <p><b>Nombre:</b> ${nombre}</p>
    <p><b>Correo:</b> ${correo}</p>
    ${asunto ? `<p><b>Asunto:</b> ${asunto}</p>` : ''}
    <p><b>Descripción:</b><br>${descripcion.replace(/\n/g,'<br>')}</p>
    <p><i>Revisar y responder al usuario con el precio y método de pago (PayPal).</i></p>
  `;

  // Email al usuario (hemos recibido tu consulta y daremos precio)
  const htmlUser = `
    <h2>¡Gracias, ${nombre}!</h2>
    <p>Hemos recibido tu consulta. La revisaremos y te enviaremos un <b>presupuesto</b> en breve.</p>
    ${asunto ? `<p><b>Asunto:</b> ${asunto}</p>` : ''}
    <p><b>Descripción enviada:</b><br>${descripcion.replace(/\n/g,'<br>')}</p>
  `;

  const adminMail = {
    from: `"Consultas" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `Consulta de PAGO (PRESUPUESTO) - ${nombre}${asunto ? ' - ' + asunto : ''}`,
    html: htmlAdmin
  };
  if (adj) {
    adminMail.attachments = [{ filename: adj.originalname || path.basename(adj.path), path: adj.path }];
  }

  Promise.allSettled([
    transporter.sendMail(adminMail),
    transporter.sendMail({
      from: `"Guía Técnica Pericial" <${process.env.SMTP_USER}>`,
      to: correo,
      subject: 'Hemos recibido tu consulta (te enviaremos presupuesto)',
      html: htmlUser
    })
  ]).then(([a,u]) => {
    if (a.status === 'rejected') console.error('Admin mail error:', a.reason);
    if (u.status === 'rejected') console.error('User mail error:', u.reason);
  }).catch(err => console.error('Mail error:', err))
    .finally(() => { if (adj?.path) try { fs.unlinkSync(adj.path); } catch {} });
});

module.exports = router;