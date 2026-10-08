/* Saisie vocale (Web Speech API, lorsque le navigateur la propose). Le texte dicté est ajouté au champ. */
import { toast } from './dom.js';

let active = null;
export function dictate(target) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) return toast('Saisie vocale non disponible sur ce navigateur.', 'warn');
  if (!target) return;
  if (active) { active.stop(); active = null; return; }
  const rec = new SR();
  rec.lang = 'fr-FR'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
  rec.onresult = e => {
    const text = [...e.results].map(r => r[0].transcript).join(' ').trim();
    if (!text) return;
    const sep = target.value && !/\s$/.test(target.value) ? ' ' : '';
    target.value = target.value + sep + text.charAt(0).toUpperCase() + text.slice(1);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  };
  rec.onerror = e => toast(e.error === 'network' ? 'La dictée nécessite une connexion sur ce navigateur.' : e.error === 'not-allowed' ? 'Micro non autorisé.' : 'Dictée interrompue.', 'warn');
  rec.onend = () => { active = null; target.classList.remove('listening'); };
  target.classList.add('listening');
  toast('🎤 Parlez maintenant…', '', 1500);
  rec.start(); active = rec;
}
