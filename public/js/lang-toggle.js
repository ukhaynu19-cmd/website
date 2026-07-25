function isBadCacheEntry(text) {
  return typeof text !== 'string' || text.toUpperCase().includes('MYMEMORY WARNING');
}

async function setLanguage(lang) {
  const elements = document.querySelectorAll('[data-en]');

  if (lang === 'en' || lang === 'bn') {
    elements.forEach(el => {
      const text = lang === 'bn' ? el.getAttribute('data-bn') : el.getAttribute('data-en');
      if (text !== null) el.textContent = text;
    });
  } else if (lang === 'ja') {
    const cacheKey = 'hac-ja-cache';
    let cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
    const toTranslate = [];
    const targets = [];

    elements.forEach(el => {
      const enText = el.getAttribute('data-en');
      if (!enText) return;
      if (cache[enText] && !isBadCacheEntry(cache[enText])) {
        el.textContent = cache[enText];
      } else {
        toTranslate.push(enText);
        targets.push(el);
      }
    });

    if (toTranslate.length > 0) {
      try {
        const res = await fetch('/api/translate-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: toTranslate, to: 'ja' })
        });
        const data = await res.json();
        data.translations.forEach((translated, i) => {
          targets[i].textContent = translated;
          if (!isBadCacheEntry(translated)) {
            cache[toTranslate[i]] = translated;
          }
        });
        localStorage.setItem(cacheKey, JSON.stringify(cache));
      } catch (err) {
        console.error('Live translation failed:', err);
      }
    }
  }

  document.documentElement.lang = lang;
  localStorage.setItem('hac-lang', lang);
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('lang-' + lang);
  if (activeBtn) activeBtn.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('hac-lang') || 'en';
  setLanguage(saved);
});