const mongoose = require('mongoose');

const inscripcionSchema = new mongoose.Schema({
  nombre: String,
  apellido: String,
  correo: {
    type: String,
    required: true,
    unique: true
  },
  contrasena: {
    type: String,
    required: true
  },
  direccion: String,
  ciudad: String,
  cp: String,        // Código Postal
  pais: String,      // País
  verificado: { type: Boolean, default: false },
  token: String
});

module.exports = mongoose.model('Inscripcion', inscripcionSchema);