/* Set de iconos de línea monocromo (trazo 1.75, currentColor) — reemplaza los emoji.
   Mapea claves semánticas Y los emoji usados en la app, para cablear sin tocar cada caller. */
const P: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z',
  gear: 'M4 6h16M14 4v4M4 12h16M9 10v4M4 18h16M15 16v4',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l3.5 4V6L6 10H4a1 1 0 0 0-1 1Zm11-4v10a4 4 0 0 0 0-10Z',
  building: 'M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 21V9h5a1 1 0 0 1 1 1v11M3 21h18M7 8h3M7 12h3M7 16h3',
  calendar: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6ZM4 9h16M8 3v4M16 3v4',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z',
  queue: 'M4 6h16M4 12h16M4 18h10M18 16l3 2-3 2',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  bell: 'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0',
  key: 'M15 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l6.1-6.1A4 4 0 0 1 15 7Zm.5 1.5h.01',
  camera: 'M4 8a1 1 0 0 1 1-1h2l1.5-2h7L18 7h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  mail: 'M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Zm1 1 8 6 8-6',
  box: 'M3 8l9-4 9 4v8l-9 4-9-4V8Zm0 0 9 4 9-4M12 12v8',
  card: 'M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm0 3h18M6 15h4',
  coins: 'M8 8a5 3 0 1 0 0-6 5 3 0 0 0 0 6Zm0 0v10c0 1.7 2.2 3 5 3s5-1.3 5-3M3 11c0 1.7 2.2 3 5 3M16 8.5c2.4.4 4 1.5 4 2.8v6',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 4a3.5 3.5 0 0 1 0 7M21 20v-1a4 4 0 0 0-3-3.8',
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-6h4v6',
  bank: 'M12 3 3 8h18l-9-5ZM5 10v7M9 10v7M15 10v7M19 10v7M3 20h18',
  ticket: 'M4 8a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4V8Zm10-1v10',
  door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01',
  receipt: 'M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21V3Zm3 5h6M9 12h6M9 16h4',
  scale: 'M12 3v18M7 21h10M12 6l-6 2 6-2 6 2-6-2M6 8l-3 5a3 3 0 0 0 6 0l-3-5Zm12 0-3 5a3 3 0 0 0 6 0l-3-5Z',
  contact: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm8 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-4 5a4 4 0 0 1 8 0',
  vote: 'M9 12l2 2 4-4M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z',
  wrench: 'M15 6a4 4 0 0 0-5.2 5.2l-6 6a1.5 1.5 0 0 0 2.1 2.1l6-6A4 4 0 0 0 19 8l-3 3-2-2 3-3a4 4 0 0 0-2-.99Z',
  pool: 'M3 18c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1M6 15V6a2 2 0 0 1 4 0M6 10h4M14 15V6a2 2 0 0 1 4 0M14 10h4',
  dumbbell: 'M6 9v6M4 8v8M18 9v6M20 8v8M6 12h12',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  alert: 'M12 4 2 20h20L12 4Zm0 6v5m0 3h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  pin: 'M9 3h6l-1 2v6l3 4H7l3-4V5L9 3Zm3 12v6',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13 6 5h12l2 8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6Z',
  check: 'M5 13l4 4L19 7',
  cart: 'M3 4h2l2.5 12h10L20 8H6M9 20a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  guard: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0M8 5l4-2 4 2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
  expense: 'M4 7h16M4 12h16M4 17h10M17 15l3 3-3 3M20 18h-6',
  phone: 'M5 4h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z',
  spark: 'M13 3 4 14h6l-1 7 9-11h-6l1-7Z',
  file: 'M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v4h4',
  imagen: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm0 11 4.5-4.5 3.5 3.5 3-3L20 16M9 9h.01',
}
/* alias emoji → clave */
const E: Record<string, string> = {
  '📊': 'dashboard', '📢': 'megaphone', '🏢': 'building', '📅': 'calendar', '🛡️': 'shield', '🛡': 'shield',
  '🚦': 'queue', '🗺️': 'map', '🗺': 'map', '🔔': 'bell', '🔑': 'key', '📷': 'camera', '📨': 'mail', '✉️': 'mail', '✉': 'mail',
  '📦': 'box', '💳': 'card', '💰': 'coins', '👥': 'users', '🏠': 'home', '🏛️': 'bank', '🏛': 'bank',
  '🎫': 'ticket', '🎟️': 'ticket', '🎟': 'ticket', '🚪': 'door', '🧾': 'receipt', '⚖️': 'scale', '⚖': 'scale',
  '📇': 'contact', '🗳️': 'vote', '🗳': 'vote', '🔧': 'wrench', '🏊': 'pool', '🏋️': 'dumbbell', '🏋': 'dumbbell',
  '🎉': 'sparkle', '🚨': 'alert', '👤': 'user', '📌': 'pin', '📭': 'inbox', '✅': 'check', '🛒': 'cart',
  '👮': 'guard', '⏳': 'clock', '🏚': 'building', '💸': 'expense', '📆': 'calendar', '🚀': 'spark', '⚡': 'spark',
  '🔒': 'lock', '📲': 'phone', '📞': 'phone', '📥': 'inbox', '⚠️': 'alert', '⚠': 'alert', '🏦': 'bank',
  '✎': 'wrench', '🗑': 'expense',
}

export function Icon({ name, size = 20, className, style }: { name?: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const key = name ? (P[name] ? name : E[name.trim()]) : undefined
  const d = key && P[key]
  if (!d) return <span className={className} style={style} aria-hidden="true">{d ? null : (name && !E[name.trim()] && name.length <= 2 ? name : '')}</span>
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
