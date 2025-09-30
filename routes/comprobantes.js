const express = require('express');
const router = express.Router();
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Subida de archivos (temporal)
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato no permitido. Sube PDF o imagen (PNG/JPG).'));
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

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/enviar-comprobante', upload.single('comprobante'), (req, res) => {
  const { nombre, correo, concepto } = req.body;
  const archivo = req.file;

  console.log('[FORM] nombre:', nombre, 'correo:', correo, 'concepto:', concepto, 'file?', !!archivo);

  if (!nombre || !correo || !concepto || !archivo) {
    try { if (archivo?.path) fs.unlinkSync(archivo.path); } catch {}
    return res.status(400).send('Faltan datos del formulario.');
  }

  if (!isValidEmail(correo)) {
    try { if (archivo?.path) fs.unlinkSync(archivo.path); } catch {}
    return res.status(400).send('El correo del usuario no es válido.');
  }

  // Redirige YA al usuario (no bloquea por SMTP)
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const redirectTo = base ? `${base}/gracias.html` : '/gracias.html';
  console.log('[REDIRECT] ->', redirectTo);
  res.redirect(redirectTo);

  const transporter = createTransporter();

  // 1) Email al ADMIN (con adjunto)
  const mailAdmin = {
    from: `"Comprobantes" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `Comprobante de pago - ${concepto} - ${nombre}`,
    text: `Nuevo comprobante de ${nombre} (${correo}). Concepto: ${concepto}`,
    html: `
      <h3>Nuevo comprobante de pago</h3>
      <p><b>Nombre:</b> ${nombre}</p>
      <p><b>Correo:</b> ${correo}</p>
      <p><b>Concepto:</b> ${concepto}</p>
    `,
    attachments: [{ filename: archivo.originalname || path.basename(archivo.path), path: archivo.path }]
  };

  // 2) Email de “gracias” al USUARIO (sin adjunto)
  const htmlUsuario = `
    <!doctype html><html><head><meta charset="utf-8"><title>Confirmación de envío</title></head>
    <body style="font-family:Arial,Helvetica,sans-serif; background:#f8f8f3; margin:0; padding:20px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
             style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;">
        <tr><td style="padding:24px; text-align:center;">
          <h1 style="color:#198754; margin:0 0 12px 0;">✅ ¡Gracias, ${nombre}!</h1>
          <p style="margin:0 0 16px 0; color:#333;">Hemos recibido tu comprobante de pago correctamente.</p>
          <p style="margin:0 0 16px 0; color:#333;">
            <b>Concepto:</b> ${concepto}<br>
            <b>Correo:</b> ${correo}
          </p>
          <p style="margin:0 0 16px 0; color:#333;">En breve verificaremos la información y te contactaremos.</p>
          <div style="margin-top:24px;">
            <a href="${base || 'http://localhost:3001'}/zona-privada.html"
               style="background:#9DA588;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block;">
              Volver a la Zona Privada
            </a>
          </div>
        </td></tr>
      </table>
      <p style="text-align:center; color:#888; font-size:12px; margin-top:12px;">
        Este mensaje es automático. No respondas a este correo.
      </p>
    </body></html>
  `;
  const mailUsuario = {
    from: `"Guía Técnica Pericial" <${process.env.SMTP_USER}>`,
    to: correo,
    subject: 'Hemos recibido tu comprobante de pago',
    html: htmlUsuario
  };

  // Envía en paralelo y loguea resultados
  Promise.allSettled([
    transporter.sendMail(mailAdmin),
    transporter.sendMail(mailUsuario)
  ]).then(results => {
    const [rAdmin, rUser] = results;
    console.log('[MAIL ADMIN]', rAdmin.status, rAdmin.reason || rAdmin.value?.messageId);
    console.log('[MAIL USER ]', rUser.status,  rUser.reason  || rUser.value?.messageId);
  }).catch(err => {
    console.error('[MAIL ERROR] Algo general falló:', err);
  }).finally(() => {
    try { fs.unlinkSync(archivo.path); } catch {}
  });
});

module.exports = router;