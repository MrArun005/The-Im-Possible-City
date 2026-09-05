/* Shared scroll engine: parallax layers, reveal-on-scroll, progress, marquee. */
(function(){
  const layers=[...document.querySelectorAll('.stage .layer')];
  const progress=document.querySelector('.progress');
  const marquees=[...document.querySelectorAll('.marquee span')];
  let ticking=false;
  function frame(){
    ticking=false;
    const y=window.scrollY;
    const max=document.documentElement.scrollHeight-window.innerHeight||1;
    const t=Math.min(1,y/max);
    if(progress) progress.style.width=(t*100)+'%';
    layers.forEach(l=>{
      const speed=parseFloat(l.dataset.speed||'0.2');
      const rot=parseFloat(l.dataset.rotate||'0');
      const scale=1+t*parseFloat(l.dataset.scale||'0');
      l.style.transform=`translate3d(0,${-y*speed}px,0) rotate(${t*rot}deg) scale(${scale})`;
    });
    marquees.forEach(m=>{const dir=m.parentElement.dataset.dir==='left'?-1:1;m.style.transform=`translateX(${dir*(-30+t*60)}%)`;});
    document.documentElement.style.setProperty('--t',t);
  }
  window.addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(frame);}},{passive:true});
  window.addEventListener('resize',frame);
  frame();
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in');}),{threshold:.2});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
  // tell parent (master site) which panel is active, for the embedded viewer
  const panels=[...document.querySelectorAll('section.panel')];
  const pio=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting&&window.parent!==window)window.parent.postMessage({type:'layer-panel',index:panels.indexOf(e.target),total:panels.length,title:document.title},'*');}),{threshold:.6});
  panels.forEach(p=>pio.observe(p));
})();
