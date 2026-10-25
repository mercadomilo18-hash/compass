// Photo / screenshot -> events and tasks, with the user approving each item.

import { state, update, logAction } from './store.js';
import * as AI from './ai.js';
import { modal, field, toast, icon } from './ui.js';
import { h } from './util.js';

function pickImage() {
  return new Promise((resolve) => {
    // On iPhone this offers Take Photo, Photo Library or Files.
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

export async function scanFlow() {
  if (!state.settings.apiKey) { toast('Add your Claude API key in Settings to scan photos.', 5000); return; }
  const file = await pickImage();
  if (!file) return;
  let base64;
  try { base64 = await AI.imageToBase64(file); } catch { toast('Couldn’t read that image. Try a JPG or PNG screenshot.'); return; }
  modal({
    title: 'Scan photo',
    body: `<img class="scan-preview" src="data:image/jpeg;base64,${base64}" alt="Your photo">
      ${field('Anything Compass should know? (optional)', '<input name="note" placeholder="e.g. This is my fall timetable, classes repeat weekly">')}`,
    submit: 'Find events',
    onSubmit: async (v, form) => {
      const btn = form.querySelector('.btn.primary');
      btn.disabled = true; btn.textContent = 'Reading…';
      try {
        const r = await AI.scanImage(base64, v.note);
        setTimeout(() => review(r));
      } catch (e) {
        toast(e.message, 6000);
        btn.disabled = false; btn.textContent = 'Find events';
        return false;
      }
    },
  });
}

function review({ text, proposals }) {
  if (!proposals.length) {
    modal({ title: 'Nothing found', body: `<p>${h(text || 'Compass couldn’t find any dates or deadlines in that image.')}</p>` });
    return;
  }
  modal({
    title: `Found ${proposals.length} item${proposals.length > 1 ? 's' : ''}`,
    body: `${text ? `<p class="muted small">${h(text)}</p>` : ''}
      <ul class="list">${proposals.map((p, i) => { const d = AI.describeTool(p.name, p.input); return `<li class="item"><label class="check grow">
        <input type="checkbox" name="p${i}" checked><span><span class="muted small">${h(d.title)}</span><br><strong>${h(d.body)}</strong>${p.input.notes ? `<br><span class="muted small">${h(p.input.notes)}</span>` : ''}</span></label></li>`; }).join('')}</ul>
      <p class="muted small">Untick anything wrong. You can edit items afterwards.</p>`,
    submit: 'Add selected',
    onSubmit: (v) => {
      let added = 0, failed = 0;
      update((s) => {
        proposals.forEach((p, i) => {
          if (!v[`p${i}`]) return;
          try { const summary = AI.applyTool(s, p.name, p.input); logAction('ai', `From photo: ${summary}`, 'approved', 'Compass AI'); added++; }
          catch { failed++; }
        });
      });
      toast(`Added ${added}${failed ? `, ${failed} couldn’t be added` : ''}`);
    },
  });
}

export const scanButton = (label = 'Scan photo') => `<button class="btn small" data-act="scanPhoto">${icon('camera', 16)} ${label}</button>`;
