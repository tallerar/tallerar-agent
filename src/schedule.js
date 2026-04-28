// Horario del agente IA (hora de Chile, UTC-4 en invierno / UTC-3 en verano)
// Agente activo: Lun-Sab 19:15 - 09:45 del día siguiente / Domingo 00:00-24:00

function isAgentActive() {
  // Hora actual en Chile
  const now = new Date();
  const clTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const day = clTime.getDay(); // 0=Dom, 1=Lun, 2=Mar, 3=Mie, 4=Jue, 5=Vie, 6=Sab
  const hour = clTime.getHours();
  const min = clTime.getMinutes();
  const timeInMin = hour * 60 + min; // minutos desde medianoche

  const START = 19 * 60 + 15; // 19:15 = 1155 min
  const END = 9 * 60 + 45;    // 09:45 = 585 min

  // Domingo: activo las 24 horas
  if (day === 0) return true;

  // Lunes a Sábado: activo de 19:15 a medianoche O de 00:00 a 09:45
  if (day >= 1 && day <= 6) {
    if (timeInMin >= START) return true;  // 19:15 en adelante
    if (timeInMin <= END) return true;    // hasta 09:45
    return false; // 09:46 a 19:14 → equipo humano
  }

  return false;
}

function getOfflineMessage() {
  return '¡Hola! 👋 En este momento nuestro equipo de ventas te está atendiendo directamente. Escríbenos y te respondemos enseguida 🌸';
}

module.exports = { isAgentActive, getOfflineMessage };
