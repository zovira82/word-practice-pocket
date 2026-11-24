(() => {
  'use strict';
  const { questions, operations } = window.WORD_DATA;
  const topics = window.WORD_TOPICS;
  const ids = new Map(questions.map(q => [q.id, q]));
  const years = [...new Set(questions.map(q => q.year))].reverse();
  const main = document.getElementById('main');
  const dialog = document.getElementById('dialog');
  const status = document.getElementById('status');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const STORAGE = 'word-contest-practice-v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
  const button = (action, label, cls = 'button secondary', attributes = '') =>
    `<button type="button" class="${cls}" data-action="${action}" ${attributes}>${label}</button>`;
  const select = (name, label, choices, value, cls = '') =>
    `<select class="${cls}" name="${name}" aria-label="${label}">${choices.map(([key, text]) =>
      `<option value="${esc(key)}" ${String(key) === String(value) ? 'selected' : ''}>${esc(text)}</option>`
    ).join('')}</select>`;
  const progress = (value, label) => `<div class="progress" role="progressbar" aria-label="${label}" aria-valuenow="${Math.round(value * 100)}" style="--progress:${value}"><span></span></div>`;
  const headings = (title, text, extra = '') => `<div class="heading"><div><h1>${title}</h1><p>${text}</p></div>${extra}</div>`;
  const optionsFor = values => values.map(value => [value, value]);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORAGE) || '{}') || {}; } catch {}
  const state = {
    year: '2025', kind: 'all', order: 'original', topic: 'all', mode: 'practice',
    caseId: '2025-invite', opMode: 'steps', position: '', currentStep: {},
    attempts: {}, wrong: {}, stars: {}, seen: {}, mastered: {}, checklists: {}, timers: {},
    notebook: '', ...saved
  };
  let route, queue = [], current = 0;
  let selection = [];
  let result = null;
  let shuffleOrder = [];
  let advanceTimer;
  let progressTimer;
  let swipe;
  let swallowClick = 0;
  let tutorialOpen = false;
  let recallChoice = null;
  let displayTopic = '编辑与快捷键';

  function say(text) {
    clearTimeout(progressTimer);
    status.textContent = text;
    progressTimer = setTimeout(() => { status.textContent = ''; }, 1550);
  }
  function save() {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
    catch { say('浏览器空间不可用，学习记录未能保存'); }
  }
  function topicFor(question) {
    const exact = ['页面布局', '页眉页脚', '表格', '引用', '图文对象', '编辑与快捷键', '文字排版', '文件与视图'];
    return exact.find(key => topics[key][0].test(question.stem)) || '文件与视图';
  }
  function explanationFor(question) {
    const answer = question.answer.map(id => question.options[id]).join('、');
    return window.WORD_EXPLANATIONS.find(([stem, correct]) => stem.test(question.stem) && correct.test(answer))?.[2];
  }
  function dedupKey(question) {
    const clean = str => str.normalize('NFKC').toLowerCase().replace(/[\s_。．，（）()]/g, '');
    return JSON.stringify([
      clean(question.stem), Object.values(question.options).map(clean).sort(),
      question.answer.map(id => clean(question.options[id])).sort()
    ]);
  }
  function refreshQueue(keepPosition = true) {
    let candidates = questions.filter(q =>
      (state.year === 'all' || String(q.year) === state.year) &&
      (state.kind === 'all' || state.kind === q.kind) &&
      (state.topic === 'all' || topicFor(q) === state.topic)
    ).sort((a,b) => b.year-a.year || a.number-b.number);
    if (state.order === 'wrong') candidates = candidates.filter(q => state.wrong[dedupKey(q)]);
    if (state.order === 'stars') candidates = candidates.filter(q => state.stars[dedupKey(q)]);
    if (state.year === 'all') {
      const found = new Set();
      candidates = candidates.filter(q => {
        const key = dedupKey(q);
        if (found.has(key)) return false;
        found.add(key);
        return true;
      });
    }
    if (state.order === 'random') {
      const known = new Map(candidates.map(q=>[q.id,q]));
      if (shuffleOrder.length !== candidates.length || shuffleOrder.some(id=>!known.has(id))) {
        shuffleOrder = candidates.map(q=>q.id);
        for (let i=shuffleOrder.length-1;i>0;i--) {
          const j=Math.floor(Math.random()*(i+1));
          [shuffleOrder[i],shuffleOrder[j]]=[shuffleOrder[j],shuffleOrder[i]];
        }
      }
      candidates=shuffleOrder.map(id=>known.get(id));
    }
    queue = candidates;
    current = keepPosition ? Math.max(0, queue.findIndex(q=>q.id===state.position)) : 0;
    state.position = queue[current]?.id || '';
  }

  function opening() {
    route = location.hash === '#operations' ? 'operations' : location.hash === '#knowledge' ? 'knowledge' : 'quiz';
    clearTimeout(advanceTimer);
    selection = [];
    result = null;
    tutorialOpen = false;
    recallChoice = null;
    document.querySelectorAll('nav a').forEach(a=> {
      if (a.hash === '#' + route) a.setAttribute('aria-current','page');
      else a.removeAttribute('aria-current');
    });
    if (dialog.open) dialog.close();
    if (route === 'quiz') refreshQueue();
    render();
    window.scrollTo(0,0);
  }
  const animate = (target, frames, duration = 175) => {
    if (target && !motion.matches && typeof target.animate === 'function') {
      target.animate(frames, { duration, easing:'cubic-bezier(.2,.75,.25,1)' });
    }
  };
  function segment(action, left, right, active, labels) {
    return `<div class="segment" style="--selected:${active===right?1:0}">
      ${button(action, labels[0], '', `data-value="${left}" aria-pressed="${active===left}"`)}
      ${button(action, labels[1], '', `data-value="${right}" aria-pressed="${active===right}"`)}
    </div>`;
  }
  function quizShell() {
    return `${headings('客观题练习','2020—2025 年区域赛 · Word 科目')}
    <div class="split">
      <section class="paper" aria-label="练习题">
        <div class="quiz-header">
          <div class="quiz-top">
            ${segment('mode','memory','practice',state.mode,['背题','刷题'])}
            <span class="spacer"></span>
            <span class="sheet-progress" id="counter"></span>
            ${button('map','▦','icon-button','aria-label="打开答题卡"')}
          </div>
          <div class="filters">
            ${select('year','年份',[['all','全部年份'],...years.map(y=>[y,y+' 年'])],state.year)}
            ${select('kind','题型',[['all','全部题型'],...optionsFor(['单选','不定项','判断'])],state.kind)}
            ${select('order','练习顺序',[['original','原卷顺序'],['random','随机'],['wrong','错题'],['stars','收藏']],state.order)}
            ${select('topic','知识点',[['all','知识点'],...optionsFor(Object.keys(topics))],state.topic)}
          </div>
          ${progress(0,'题目位置')}
        </div>
        <div class="stage" id="stage"></div>
        <div class="foot">
          ${button('prev','‹ 上一题')}
          ${button('notebook','笔记','link-button')}
          ${button('next','下一题 ›','button')}
        </div>
      </section>
      <aside class="quiz-side">
        <section class="side" id="quiz-progress"></section>
        <section class="side sample">
          <img src="assets/2025-invite/reference-1.jpg" alt="2025 年研发部邀请函参考效果">
          <div class="sample-body">
            <h2>研发部邀请函</h2><p>2025 年操作题 · ${operations.at(-1).steps.length} 个练习步骤</p>
            ${button('open-case','查看分步练习','link-button','data-id="2025-invite"')}
          </div>
        </section>
      </aside>
    </div>`;
  }
  function renderQuizQuestion(direction = 0, reveal = false) {
    const question = queue[current];
    const stage = document.getElementById('stage');
    const counter = document.getElementById('counter');
    const bar = main.querySelector('.progress');
    const next = main.querySelector('[data-action=next]');
    const prev = main.querySelector('[data-action=prev]');
    const ratio = queue.length ? (current+1) / queue.length : 0;
    counter.textContent = queue.length ? `${current+1} / ${queue.length}` : '0 题';
    bar.style.setProperty('--progress',ratio);
    bar.setAttribute('aria-valuenow',Math.round(ratio*100));
    next.disabled = !question || current === queue.length - 1;
    prev.disabled = !question || current === 0;
    const stats = queue.reduce((acc,q) => {
      if (state.seen[q.id]) acc.seen++;
      if (state.wrong[dedupKey(q)]) acc.wrong++;
      return acc;
    }, {seen:0,wrong:0});
    document.getElementById('quiz-progress').innerHTML = `<h2>当前范围</h2><div class="stat-line"><span>已练习</span><strong>${stats.seen} / ${queue.length}</strong></div><div class="stat-line"><span>待复习错题</span><strong>${stats.wrong}</strong></div>${button('review','复习错题','link-button')}`;
    if (!question) {
      stage.innerHTML = `<div class="empty"><h2>当前范围没有题目</h2><p>可以换一个年份、题型或练习顺序。</p>${button('reset-filter','查看全部题目','button')}</div>`;
      return;
    }
    const key = dedupKey(question);
    const grading = state.mode === 'memory' || result !== null;
    const topic = topicFor(question);
    const expanded = explanationFor(question);
    const correctLabels = question.kind === '判断'
      ? question.options[question.answer[0]]
      : question.answer.join('、');
    const choices = Object.entries(question.options).map(([id,label])=>{
      const checked = selection.includes(id);
      const correct = question.answer.includes(id);
      const grade = grading ? (correct?'correct':checked?'wrong':'') : '';
      const indicator = grade ? `<span class="result-icon" aria-label="${correct?'正确选项':'选错'}">${correct?'✓':'×'}</span>` : '';
      return button('choice',`<span class="letter">${id}</span><span>${esc(label)}</span>${indicator}`,
        `choice ${grade}`,`data-value="${id}" aria-pressed="${checked}" ${grading?'disabled':''}`);
    }).join('');
    stage.innerHTML = `<article class="question" data-id="${question.id}">
      <div class="question-meta"><span class="badge">${question.kind}</span><span>${question.year} 年 · 原卷第 ${question.number} 题</span><span class="spacer"></span>
      ${button('favorite',state.stars[key]?'★':'☆',`icon-button ${state.stars[key]?'saved':''}`,`aria-label="收藏本题" aria-pressed="${!!state.stars[key]}"`)}</div>
      <h2>${esc(question.stem)}</h2>
      <div class="options" role="group" aria-label="答案选项">${choices}</div>
      ${grading?`<div class="feedback ${result?.correct?'correct':result?'wrong':''}" aria-live="polite">
        <strong class="score">${result?(result.correct?'✓ 答对了':'× 答错了 · 正确答案 '+correctLabels):'参考答案 '+correctLabels}</strong>
        ${expanded?`<p>${esc(expanded)}</p>`:`<p>${esc(question.answer.map(id=>question.options[id]).join('、'))}</p>`}
        ${button('topic',topic,'link-button',`data-value="${topic}"`)}
      </div>`:question.kind==='不定项'?`<div class="submit-wrap"><span>可选一项或多项</span>${button('submit','确认答案','button',selection.length?'':'disabled')}</div>`:''}
    </article>`;
    if (direction) animate(stage.querySelector('.question'), [
      { transform:`translateX(${direction * 24}px)`, opacity:.55 },{ transform:'translateX(0)',opacity:1 }
    ]);
    if (reveal) animate(stage.querySelector('.feedback'), [{transform:'translateY(-6px)',opacity:.35},{transform:'translateY(0)',opacity:1}],145);
  }
  function move(index) {
    if (index < 0 || index >= queue.length || index === current) return;
    clearTimeout(advanceTimer);
    const direction = Math.sign(index-current);
    current=index;
    state.position=queue[index].id;
    selection=[];
    result=null;
    save();
    renderQuizQuestion(direction);
    if (matchMedia('(max-width:640px)').matches && window.scrollY > 30) window.scrollTo(0,0);
  }
  function grade() {
    const question=queue[current];
    if (!question || !selection.length || result) return;
    const correct=selection.length===question.answer.length && selection.every(id=>question.answer.includes(id));
    const key=dedupKey(question);
    state.attempts[question.id]=(state.attempts[question.id]||0)+1;
    state.seen[question.id]=true;
    if (correct) delete state.wrong[key];
    else state.wrong[key]=true;
    result={correct};
    save();
    renderQuizQuestion(0,true);
    if (correct && current+1<queue.length) {
      advanceTimer=setTimeout(()=>{
        if (route==='quiz' && state.mode==='practice' && queue[current]?.id===question.id && !dialog.open) move(current+1);
      },620);
    }
  }

  function activeCase() { return operations.find(op=>op.id===state.caseId) || operations.at(-1); }
  function currentStep(op) { return Math.min(op.steps.length-1, Math.max(0,state.currentStep[op.id] || 0)); }
  function asset(op, file) { return 'assets/'+op.id+'/'+file; }
  function stepStatus(op, i) { return state.mastered[op.id+'-'+i] || ''; }
  function references(op) {
    return op.pages.length ? `<div class="reference-grid">${op.pages.map((file,i)=>`<a href="${asset(op,file)}" target="_blank" rel="noopener" aria-label="放大参考效果 ${i+1}"><img src="${asset(op,file)}" alt="参考效果 ${i+1}" loading="lazy"></a>`).join('')}</div>` :
      '<p>此套参考效果为 Word 文档，随素材包提供。</p>';
  }
  function operationView() {
    const op=activeCase();
    const index=currentStep(op);
    const steps=op.steps.map(([name],i)=>{
      const mark=stepStatus(op,i);
      return button('step',`<span class="step-index ${mark}">${mark==='done'?'✓':mark==='review'?'↺':i+1}</span><span>${esc(name)}</span>`,'step-link',`data-index="${i}" ${i===index?'aria-current="step"':''}`);
    }).join('');
    return `${headings('Word 操作题','7 套区域赛原题 · 原始素材与参考成品')}
      <div class="split">
        <section class="paper operations-detail">
          <div class="op-top">
            ${segment('op-mode','steps','full',state.opMode,['网页练步骤','电脑版 Word 实操'])}
            ${select('case','选择操作题',operations.slice().reverse().map(item=>[item.id,item.year+' '+item.title]),op.id,'select')}
          </div>
          <div id="operation-content">${state.opMode==='steps'?stepContent(op):fullContent(op)}</div>
        </section>
        <aside>${state.opMode==='steps'?`<section class="side"><div class="case-side-head"><h2>本套步骤</h2><p>${op.steps.filter((_,i)=>stepStatus(op,i)==='done').length} / ${op.steps.length}</p></div><div class="step-links">${steps}</div></section>`:''}
          <section class="side"><h2>参考效果</h2>${references(op)}</section>
        </aside>
      </div>`;
  }
  function stepContent(op) {
    const i=currentStep(op);
    const [title,requirement,path,why,check]=op.steps[i];
    const mark=stepStatus(op,i);
    const recall=window.WORD_RECALL.find(([pattern])=>pattern.test(path))?.[1];
    return `<div class="question-meta"><span class="badge">${op.year} 年</span><span>第 ${i+1} 步，共 ${op.steps.length} 步</span></div>
      <h2 class="op-title">${esc(title)}</h2>
      <p class="operation-prompt">${esc(requirement)}</p>
      ${recall?recallContent(recall):''}
      <details class="step-detail" id="tutorial" ${tutorialOpen?'open':''}>
        <summary>查看 Word 操作步骤</summary>
        <div class="step-body">
          <p><strong>怎么操作</strong>　${esc(path)}</p>
          <p><strong>为什么这样做</strong>　${esc(why)}</p>
          <p><strong>做完怎么检查</strong>　${esc(check)}</p>
        </div>
      </details>
      <div class="step-actions">
        ${button('mark-review','需要重练','button secondary',`aria-pressed="${mark==='review'}"`)}
        ${button('mark-done','能说出步骤',mark==='done'?'button secondary':'button',`aria-pressed="${mark==='done'}"`)}
        <span class="spacer"></span>
        ${button('step-prev','‹ 上一步','button secondary',i===0?'disabled':'')}
        ${button('step-next','下一步 ›','button secondary',i===op.steps.length-1?'disabled':'')}
      </div>`;
  }
  function recallContent([question,choices,correct,why]) {
    return `<section class="recall"><h3>练一下</h3><p>${esc(question)}</p>${choices.map((choice,i)=>{
      const grade=recallChoice!==null && i===correct?'correct':recallChoice===i?'wrong':'';
      return button('recall',`${esc(choice)}${grade?`<span class="result-icon">${grade==='correct'?'✓':'×'}</span>`:''}`,`choice ${grade}`,`data-index="${i}" aria-pressed="${recallChoice===i}"`);
    }).join('')}${recallChoice!==null?`<p class="feedback ${recallChoice===correct?'correct':'wrong'}" role="status"><strong>${recallChoice===correct?'选对了':'正确做法'}</strong>　${esc(why)}</p>`:''}</section>`;
  }
  function elapsed(op) {
    const timer=state.timers[op.id];
    return timer ? timer.accumulated+(timer.started?Date.now()-timer.started:0) : 0;
  }
  function updateClock() {
    const clock=document.getElementById('clock');
    if (!clock) return;
    const seconds=Math.floor(elapsed(activeCase())/1000);
    const value=[Math.floor(seconds/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
    if (clock.textContent!==value) clock.textContent=value;
  }
  function fullContent(op) {
    const checklist=state.checklists[op.id] || [];
    const active=!!state.timers[op.id]?.started;
    return `<div class="question-meta"><span class="badge">${op.year} 年</span><span>整套实操</span></div>
      <h2 class="op-title">${esc(op.title)}</h2>
      <p>用桌面版 Word 打开练习文档，旁边保留本页看题。含插图的题需要下载完整素材包。完成后另存为 <strong>${esc(op.filename)}</strong>。</p>
      <div class="actions">
        <a class="button" href="${asset(op,'starter.docx')}" download="${esc(op.title)}-练习文档.docx">下载 Word 练习文档</a>
        <a class="button secondary" href="${asset(op,'practice.zip')}" download="${esc(op.title)}-练习素材.zip">下载完整素材包</a>
        <span class="spacer"></span><output class="clock" id="clock" aria-label="练习用时">00:00</output>${button('timer',active?'暂停计时':'开始计时')}
      </div>
      <details class="step-detail" open><summary>原题要求</summary><p class="operation-prompt">${esc(op.intro)}</p><ul class="full-list">${op.requirements.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></details>
      <details class="step-detail"><summary>完成后自查 <span id="checked-count">${checklist.filter(Boolean).length} / ${op.steps.length}</span></summary>
        <div class="check-list">${op.steps.map(([title,, , , check],i)=>`<label><input type="checkbox" name="check" value="${i}" ${checklist[i]?'checked':''}><span><strong>${esc(title)}</strong>　${esc(check)}</span></label>`).join('')}</div>
        <div class="actions"><a class="button secondary" href="${asset(op,'answer.docx')}" download="${esc(op.filename)}">下载参考成品</a>
        ${op.rubric?`<a class="button secondary" href="${asset(op,'rubric.docx')}" download="${esc(op.title)}-评分说明.docx">下载原评分说明</a>`:'<p>自查依据为原题要求与参考成品。</p>'}</div>
      </details>`;
  }
  function knowledgeView() {
    const examples=operations.filter(op=>op.steps.some(step=>step[5]===displayTopic));
    const [,basics,detail]=topics[displayTopic];
    const amount=questions.filter(q=>topicFor(q)===displayTopic).length;
    return `${headings('Word 知识点','从功能入口复习，再做对应原题')}
      <div class="split">
        <section class="paper knowledge-detail">
          <h2>${displayTopic}</h2><p>${basics}</p><p>${detail}</p>
          <div class="actions">${button('topic-quiz',`练习相关客观题（${amount} 道）`,'button')}</div>
          ${examples.length?`<div class="step-detail"><h3>相关操作题</h3><div class="actions">${examples.map(item=>button('open-case',`${item.year} ${esc(item.title)}`,'button secondary',`data-id="${item.id}" data-topic="${displayTopic}"`)).join('')}</div></div>`:''}
        </section>
        <aside class="side"><h2>选择知识点</h2><div class="knowledge-list">${Object.keys(topics).map(key=>button('topic',key,'step-link',`data-value="${key}" ${key===displayTopic?'aria-current="step"':''}`)).join('')}</div></aside>
      </div>`;
  }
  function render() {
    if(route==='quiz') {
      main.innerHTML=quizShell();
      renderQuizQuestion();
    } else {
      main.innerHTML=route==='operations'?operationView():knowledgeView();
      updateClock();
    }
  }
  function openDialog(title, content) {
    clearTimeout(advanceTimer);
    dialog.querySelector('.dialog-inner').innerHTML=`<div class="dialog-top"><h2 id="dialog-title">${title}</h2>${button('close','×','icon-button','aria-label="关闭"')}</div>${content}`;
    if (!dialog.open) dialog.showModal();
  }
  function showMap() {
    openDialog('答题卡',`<p>选择练习中的题号跳转。</p><div class="dialog-scroll"><div class="answer-grid">${queue.map((q,i)=>button('jump',i+1,state.wrong[dedupKey(q)]?'no':state.seen[q.id]?'ok':'',`data-index="${i}" aria-label="跳至第 ${i+1} 题" ${i===current?'aria-current="true"':''}`)).join('')}</div></div>`);
  }
  function showRecord() {
    const practiced=Object.keys(state.seen).length;
    const wrong=Object.keys(state.wrong).length;
    const done=Object.values(state.mastered).filter(x=>x==='done').length;
    const check=Object.values(state.checklists).reduce((n,list)=>n+list.filter(Boolean).length,0);
    openDialog('学习记录',`<p class="stat-line"><span>已答客观题</span><strong>${practiced} / ${questions.length}</strong></p>
      <p class="stat-line"><span>待复习错题</span><strong>${wrong}</strong></p>
      <p class="stat-line"><span>能复述的操作步骤</span><strong>${done}</strong></p>
      <p class="stat-line"><span>实操已自查步骤</span><strong>${check}</strong></p>
      <div class="actions">${button('review','复习错题','button')}${button('notebook','打开笔记')}</div>`);
  }
  function go(page) {
    if(location.hash==='#'+page || (!location.hash && page==='quiz')) opening();
    else location.hash=page;
  }
  function startReview() {
    Object.assign(state,{year:'all',kind:'all',topic:'all',order:'wrong',mode:'practice',position:''});
    save();
    go('quiz');
  }
  function moveStep(index) {
    const op=activeCase();
    if(index<0 || index>=op.steps.length || index===currentStep(op)) return;
    const direction=Math.sign(index-currentStep(op));
    state.currentStep[op.id]=index;
    tutorialOpen=false;
    recallChoice=null;
    save();
    render();
    animate(document.getElementById('operation-content'),[{transform:`translateX(${direction*14}px)`,opacity:.6},{transform:'translateX(0)',opacity:1}]);
    if(matchMedia('(max-width:640px)').matches) window.scrollTo(0,0);
  }

  document.addEventListener('click', event=>{
    const target=event.target.closest('[data-action]');
    if (!target) return;
    const {action,value,id}=target.dataset;
    const index=Number(target.dataset.index);
    if (swallowClick > performance.now() && action==='choice') return;
    switch(action) {
      case 'mode':
        if(state.mode===value) return;
        clearTimeout(advanceTimer);
        state.mode=value;
        main.querySelector('.segment').style.setProperty('--selected',value==='practice'?1:0);
        main.querySelectorAll('[data-action=mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===target)));
        save();
        renderQuizQuestion(0,value==='memory');
        break;
      case 'prev': move(current-1); break;
      case 'next': move(current+1); break;
      case 'choice':
        if(state.mode!=='practice'||result) return;
        if(queue[current].kind==='不定项'){
          selection=selection.includes(value)?selection.filter(id=>id!==value):[...selection,value];
          target.setAttribute('aria-pressed',String(selection.includes(value)));
          main.querySelector('[data-action=submit]').disabled=!selection.length;
        } else { selection=[value]; grade(); }
        break;
      case 'submit': grade(); break;
      case 'favorite': {
        clearTimeout(advanceTimer);
        const key=dedupKey(queue[current]);
        if(state.stars[key])delete state.stars[key];else state.stars[key]=true;
        save();
        target.classList.toggle('saved',!!state.stars[key]);
        target.setAttribute('aria-pressed',String(!!state.stars[key]));
        target.textContent=state.stars[key]?'★':'☆';
        say(state.stars[key]?'已收藏':'已取消收藏');
        break;
      }
      case 'map': showMap(); break;
      case 'jump': dialog.close(); move(index); break;
      case 'record': showRecord(); break;
      case 'review': startReview(); break;
      case 'close': dialog.close(); break;
      case 'notebook':
        openDialog('学习笔记','<textarea id="note" aria-label="学习笔记" rows="7" style="width:100%;font:inherit;padding:8px;border:1px solid #aabbe0;border-radius:8px" placeholder="记录容易混淆的 Word 操作…"></textarea>');
        document.getElementById('note').value=state.notebook;
        break;
      case 'reset-filter':
        Object.assign(state,{year:'all',kind:'all',topic:'all',order:'original'});
        opening();
        save();
        break;
      case 'open-case': {
        state.caseId=id;
        state.opMode='steps';
        if(target.dataset.topic){
          const op=activeCase();
          state.currentStep[op.id]=op.steps.findIndex(step=>step[5]===target.dataset.topic);
        }
        save();
        go('operations');
        break;
      }
      case 'op-mode':
        if(state.opMode===value)return;
        state.opMode=value;
        tutorialOpen=false;
        recallChoice=null;
        save();
        render();
        animate(document.getElementById('operation-content'),[{opacity:.5},{opacity:1}]);
        break;
      case 'step': moveStep(index); break;
      case 'step-prev': moveStep(currentStep(activeCase())-1); break;
      case 'step-next': moveStep(currentStep(activeCase())+1); break;
      case 'mark-review':
      case 'mark-done': {
        const op=activeCase();
        const i=currentStep(op);
        const mark=action==='mark-done'?'done':'review';
        state.mastered[op.id+'-'+i]=mark;
        save();
        say(mark==='done'?'已记下：能说出步骤':'已标记需要重练');
        if(mark==='done'&&i<op.steps.length-1) moveStep(i+1);
        else render();
        break;
      }
      case 'recall': {
        recallChoice=index;
        const content=document.getElementById('operation-content');
        content.innerHTML=stepContent(activeCase());
        content.querySelector(`[data-action=recall][data-index="${index}"]`)?.focus({preventScroll:true});
        animate(content.querySelector('.recall .feedback'),[{opacity:.25},{opacity:1}],150);
        break;
      }
      case 'timer': {
        const op=activeCase();
        const timer=state.timers[op.id] ||= {accumulated:0,started:0};
        if(timer.started){timer.accumulated=elapsed(op);timer.started=0;}
        else timer.started=Date.now();
        save();
        target.textContent=timer.started?'暂停计时':'继续计时';
        updateClock();
        break;
      }
      case 'topic': displayTopic=value; go('knowledge'); break;
      case 'topic-quiz':
        Object.assign(state,{year:'all',kind:'all',topic:displayTopic,order:'original',position:''});
        save();
        go('quiz');
        break;
    }
  });
  document.addEventListener('change', event=>{
    const input=event.target;
    if (['year','kind','order','topic'].includes(input.name) && route==='quiz') {
      clearTimeout(advanceTimer);
      state[input.name]=input.value;
      shuffleOrder=[];
      selection=[];
      result=null;
      refreshQueue(false);
      save();
      renderQuizQuestion(0);
    } else if(input.name==='case' && route==='operations'){
      state.caseId=input.value;
      tutorialOpen=false;
      recallChoice=null;
      save();
      render();
    } else if(input.name==='check' && route==='operations'){
      const op=activeCase();
      const list=state.checklists[op.id] ||= [];
      list[Number(input.value)]=input.checked;
      save();
      document.getElementById('checked-count').textContent=list.filter(Boolean).length+' / '+op.steps.length;
    }
  });
  document.addEventListener('input',event=>{
    if(event.target.id==='note'){state.notebook=event.target.value;save();}
  });
  document.addEventListener('toggle',event=>{
    if(event.target.id==='tutorial'){
      tutorialOpen=event.target.open;
      if(tutorialOpen)animate(event.target.querySelector('.step-body'),[{opacity:.35,transform:'translateY(-4px)'},{opacity:1,transform:'translateY(0)'}]);
    }
  },true);
  main.addEventListener('pointerdown',event=>{
    const card=event.target.closest('.question');
    if(!card || event.pointerType==='mouse' || !event.isPrimary || dialog.open ||
      event.target.closest('a, summary, [data-action]:not([data-action=choice])')) return;
    clearTimeout(advanceTimer);
    swipe={card,id:event.pointerId,x:event.clientX,y:event.clientY,dx:0};
  });
  main.addEventListener('pointermove',event=>{
    if(swipe?.id!==event.pointerId)return;
    const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;
    if(!swipe.dx && Math.abs(dx)<12)return;
    if(!swipe.dx && Math.abs(dy)>Math.abs(dx)){swipe=null;return;}
    swipe.dx=dx;
    swipe.card.classList.add('tracking');
    if(!motion.matches)swipe.card.style.transform=`translateX(${Math.max(-70,Math.min(70,dx*.45))}px)`;
  });
  function finishSwipe(event, cancelled) {
    if(swipe?.id!==event.pointerId)return;
    const {card,dx,x,y}=swipe;
    swipe=null;
    const offset=card.style.transform || 'translateX(0)';
    card.style.transform='';
    card.classList.remove('tracking');
    const distance=event.clientX-x;
    if(!cancelled && Math.abs(distance)>60 && Math.abs(distance)>Math.abs(event.clientY-y)*1.5){
      swallowClick=performance.now()+320;
      const target=current+(distance<0?1:-1);
      if(target>=0 && target<queue.length){move(target);return;}
    }
    if(dx)animate(card,[{transform:offset},{transform:'translateX(0)'}],140);
  }
  main.addEventListener('pointerup',event=>finishSwipe(event,false));
  main.addEventListener('pointercancel',event=>finishSwipe(event,true));
  window.addEventListener('hashchange',()=>{
    if(location.hash!=='#main')opening();
  });
  setInterval(updateClock,500);
  opening();
})();
