/* Scroll engine: scene progress (--p), hero zoom (--y), progress bar, reveals, parent messaging. */
(function(){
  const scenes=[...document.querySelectorAll('.scene,.strip')];
  const progress=document.querySelector('.progress');
  const hero=document.querySelector('.hero');
  let ticking=false;
  function frame(){
    ticking=false;
    const y=window.scrollY, vh=window.innerHeight;
    const max=document.documentElement.scrollHeight-vh||1;
    if(progress) progress.style.width=(y/max*100)+'%';
    if(hero) hero.style.setProperty('--y',Math.min(y,vh));
    scenes.forEach(s=>{
      const r=s.getBoundingClientRect();
      const total=r.height-vh;
      const p=total>0?Math.min(1,Math.max(0,-r.top/total)):Math.min(1,Math.max(0,(vh-r.top)/(vh+r.height)));
      s.style.setProperty('--p',p.toFixed(4));
    });
  }
  window.addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(frame);}},{passive:true});
  window.addEventListener('resize',frame);
  frame();
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in');}),{threshold:.15});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
  const panels=[...document.querySelectorAll('[data-panel]')];
  const pio=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting&&window.parent!==window)window.parent.postMessage({type:'layer-panel',index:panels.indexOf(e.target),total:panels.length,title:document.title},'*');}),{threshold:.5});
  panels.forEach(p=>pio.observe(p));
})();
