/* Space warp intro + minimal galaxy background.
   - #warp canvas: stars streak outward; speed follows scroll, intro fades as you scroll into the page.
   - #galaxy canvas: fixed, sparse twinkling stars behind the main page. */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(devicePixelRatio || 1, 2);

  /* ---------- warp intro ---------- */
  const intro = document.getElementById('intro');
  const warp = document.getElementById('warp');
  if (intro && warp) {
    const ctx = warp.getContext('2d');
    let W = 0, H = 0, cx = 0, cy = 0, stars = [], speed = 0.02, target = 0.02, progress = 0, done = false;
    const N = 420;
    const mk = () => ({ x: (Math.random() - .5) * 2, y: (Math.random() - .5) * 2, z: Math.random() * 0.9 + 0.1, pz: 0 });
    function size() {
      W = intro.clientWidth; H = intro.clientHeight; cx = W / 2; cy = H / 2;
      warp.width = W * dpr; warp.height = H * dpr; warp.style.width = W + 'px'; warp.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!stars.length) for (let i = 0; i < N; i++) { const s = mk(); s.pz = s.z; stars.push(s); }
    }
    function frame() {
      if (done) return;
      speed += (target - speed) * 0.08;
      ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.5 * (1 - Math.min(speed / 0.5, 1))})`;
      ctx.fillRect(0, 0, W, H);
      const R = Math.max(W, H);
      for (const s of stars) {
        s.pz = s.z; s.z -= speed * 0.06;
        if (s.z <= 0.02) { Object.assign(s, mk()); s.z = 1; s.pz = 1; continue; }
        const x = cx + (s.x / s.z) * R * 0.5, y = cy + (s.y / s.z) * R * 0.5;
        const px = cx + (s.x / s.pz) * R * 0.5, py = cy + (s.y / s.pz) * R * 0.5;
        if (x < -50 || x > W + 50 || y < -50 || y > H + 50) { Object.assign(s, mk()); s.z = 1; s.pz = 1; continue; }
        const t = 1 - s.z;
        ctx.strokeStyle = Math.random() < 0.12 ? `rgba(201,162,74,${0.35 + t * 0.65})` : `rgba(255,255,255,${0.25 + t * 0.75})`;
        ctx.lineWidth = 0.6 + t * 2.2;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
      }
      requestAnimationFrame(frame);
    }
    function onScroll() {
      const h = intro.offsetHeight || 1;
      progress = Math.min(Math.max(scrollY / h, 0), 1);
      target = 0.02 + progress * 1.4;                     // faster warp as you scroll
      intro.style.setProperty('--p', progress.toFixed(3));
      document.body.classList.toggle('entered', progress > 0.85);
      if (progress >= 1 && !done) { done = true; }          // stop drawing once fully scrolled past
      if (progress < 1 && done) { done = false; requestAnimationFrame(frame); }
    }
    size();
    addEventListener('resize', size, { passive: true });
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (reduce) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); for (const s of stars) { ctx.fillStyle = '#fff'; ctx.fillRect(cx + s.x * cx, cy + s.y * cy, 1.2, 1.2); } }
    else requestAnimationFrame(frame);
    document.getElementById('enter')?.addEventListener('click', (e) => {
      e.preventDefault();
      target = 2.2;                                          // punch it, then land on the main page
      setTimeout(() => document.getElementById('main-start')?.scrollIntoView({ behavior: 'smooth' }), 250);
    });
  }

  /* ---------- galaxy background ---------- */
  const g = document.getElementById('galaxy');
  if (g) {
    const ctx = g.getContext('2d');
    let W = 0, H = 0, pts = [];
    function size() {
      W = innerWidth; H = innerHeight;
      g.width = W * dpr; g.height = H * dpr; g.style.width = W + 'px'; g.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((W * H) / 9000);                  // sparse: ~100 stars on a phone, ~230 on a laptop
      pts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.3, a: Math.random() * 6.28, s: 0.004 + Math.random() * 0.012, gold: Math.random() < 0.08 }));
    }
    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      for (const p of pts) {
        const tw = reduce ? 0.6 : 0.45 + 0.4 * Math.sin(p.a + t * p.s);
        ctx.fillStyle = p.gold ? `rgba(231,200,122,${tw})` : `rgba(255,255,255,${tw * 0.8})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(draw);
    }
    size(); addEventListener('resize', size, { passive: true }); requestAnimationFrame(draw);
  }
})();
