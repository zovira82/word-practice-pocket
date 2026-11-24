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
    return `<h1 class="sr-only">客观题练习</h1>
      <section class="paper practice-page" aria-label="练习题">
        <div class="quiz-header">
          <div class="quiz-top">
            ${segment('mode','memory','practice',state.mode,['背题','刷题'])}
            <span class="spacer"></span>
            ${button('map','<span id="counter"></span><span aria-hidden="true">▦</span>','button secondary sheet-progress','aria-label="打开答题卡"')}
          </div>
          ${progress(0,'题目位置')}
        </div>
        <div class="stage" id="stage"></div>
        <div class="foot">
          ${button('prev','‹ 上一题')}
          ${button('next','下一题 ›','button')}
        </div>
      </section>`;
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
    counter.parentElement.disabled = !question;
    if (!question) {
      stage.innerHTML = `<div class="empty"><h2>当前范围没有题目</h2><p>可以换一个年份、题型或练习顺序。</p>${button('reset-filter','查看全部题目','button')}</div>`;
      return;
    }
    const memory = state.mode === 'memory';
    const attempt = memory ? null : result;
    const grading = memory || attempt !== null;
    const topic = topicFor(question);
    const expanded = explanationFor(question);
    const correctLabels = question.kind === '判断'
      ? question.options[question.answer[0]]
      : question.answer.join('、');
    const choices = Object.entries(question.options).map(([id,label])=>{
      const checked = !memory && selection.includes(id);
      const correct = question.answer.includes(id);
      const grade = grading ? (correct?'correct':checked?'wrong':'') : '';
      const indicator = grade ? `<span class="result-icon" aria-label="${correct?'正确选项':'选错'}">${correct?'✓':'×'}</span>` : '';
      return button('choice',`<span class="letter">${id}</span><span>${esc(label)}</span>${indicator}`,
        `choice ${grade}`,`data-value="${id}" aria-pressed="${checked}" ${grading?'disabled':''}`);
    }).join('');
    stage.innerHTML = `<article class="question" data-id="${question.id}">
      <div class="question-meta"><span class="badge">${question.kind}</span><span>${question.year} 年 · 原卷第 ${question.number} 题</span></div>
      <h2>${esc(question.stem)}</h2>
      ${grading?`<div class="feedback ${attempt?.correct?'correct':attempt?'wrong':''}" aria-live="polite">
        <strong class="score">${attempt?(attempt.correct?'✓ 答对了':'× 答错了 · 正确答案 '+correctLabels):'参考答案 '+correctLabels}</strong>
        ${expanded?`<p>${esc(expanded)}</p>`:question.kind!=='判断'?`<p>${esc(question.answer.map(id=>question.options[id]).join('、'))}</p>`:''}
        ${button('topic',topic+' ›','link-button feedback-topic',`data-value="${topic}"`)}
      </div>`:''}
      <div class="options" role="group" aria-label="答案选项">${choices}</div>
      ${!grading && question.kind==='不定项'?`<div class="submit-wrap"><span>可选一项或多项</span>${button('submit','确认答案','button',selection.length?'':'disabled')}</div>`:''}
    </article>`;
    if (direction) animate(stage.querySelector('.question'), [
      { transform:`translateX(${direction * 24}px)`, opacity:.55 },{ transform:'translateX(0)',opacity:1 }
    ]);
    if (reveal) revealFeedback(stage.querySelector('.feedback'));
  }
  function revealFeedback(feedback) {
    if (!feedback) return;
    animate(feedback,[{transform:'translateY(-5px)',opacity:.35},{transform:'translateY(0)',opacity:1}],145);
    const {top,bottom}=feedback.getBoundingClientRect();
    if (top<0 || bottom>window.innerHeight-48) feedback.scrollIntoView({block:'nearest',behavior:motion.matches?'instant':'smooth'});
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
    return `<h1 class="sr-only">Word 操作题</h1>
        <section class="paper practice-page operations-detail">
          <div class="op-top">
            ${segment('op-mode','steps','full',state.opMode,['分步练','Word 实操'])}
            ${select('case','选择操作题',operations.slice().reverse().map(item=>[item.id,item.year+' '+item.title]),op.id,'select')}
          </div>
          <div id="operation-content">${state.opMode==='steps'?stepContent(op):fullContent(op)}</div>
        </section>`;
  }
  function stepContent(op) {
    const i=currentStep(op);
    const [title,requirement,path,why,check]=op.steps[i];
    const mark=stepStatus(op,i);
    const recall=window.WORD_RECALL.find(([pattern])=>pattern.test(path))?.[1];
    return `<div class="question-meta">${button('step-map',`第 ${i+1} / ${op.steps.length} 步 <span aria-hidden="true">▦</span>`,'button secondary compact','aria-label="打开步骤目录"')}</div>
      <h2 class="op-title">${esc(title)}</h2>
      ${recall?recallContent(recall):''}
      <details class="step-detail" id="tutorial" ${tutorialOpen?'open':''}>
        <summary>操作路径与原题</summary>
        <div class="step-body">
          <p><strong>操作</strong>　${esc(path)}</p>
          <p><strong>原因</strong>　${esc(why)}</p>
          <p><strong>检查</strong>　${esc(check)}</p>
          <p class="operation-prompt">${esc(requirement)}</p>
        </div>
      </details>
      <div class="step-actions">
        ${button('step-prev','‹ 上一步','button secondary',i===0?'disabled':'')}
        ${button('step-mark',mark==='done'?'已掌握':mark==='review'?'待重练':'标记','link-button')}
        ${button('step-next','下一步 ›','button',i===op.steps.length-1?'disabled':'')}
      </div>`;
  }
  function recallContent([question,choices,correct,why]) {
    return `<section class="recall" aria-label="分步练习"><p>${esc(question)}</p>
    ${recallChoice!==null?`<p class="feedback ${recallChoice===correct?'correct':'wrong'}" role="status"><strong>${recallChoice===correct?'选对了':'正确做法'}</strong>　${esc(why)}</p>`:''}
    ${choices.map((choice,i)=>{
      const grade=recallChoice!==null && i===correct?'correct':recallChoice===i?'wrong':'';
      return button('recall',`${esc(choice)}${grade?`<span class="result-icon">${grade==='correct'?'✓':'×'}</span>`:''}`,`choice ${grade}`,`data-index="${i}" aria-pressed="${recallChoice===i}"`);
    }).join('')}</section>`;
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
    return `<div class="practical-bar">
        <a class="button" href="${asset(op,'practice.zip')}" download="${esc(op.title)}-练习素材.zip">下载整套素材</a>
        <button type="button" class="button secondary timer-button" data-action="timer">
          <span id="clock" class="clock">00:00</span><span data-timer-label>${active?'暂停':'计时'}</span>
        </button>
      </div>
      <p class="file-instruction">用电脑 Word 操作，另存为 <strong>${esc(op.filename)}</strong></p>
      <div class="task-heading"><h2>实操清单</h2><span id="checked-count">${checklist.filter(Boolean).length} / ${op.steps.length}</span></div>
      <div class="check-list">${op.steps.map(([title,requirement,,,check],i)=>`
        <div class="task-row">
          <input type="checkbox" name="check" value="${i}" aria-label="完成 ${esc(title)}" ${checklist[i]?'checked':''}>
          <details>
            <summary>${esc(title)}</summary>
            <p>${esc(requirement)}</p>
            <p><strong>自查</strong>　${esc(check)}</p>
          </details>
        </div>`).join('')}</div>
      <details class="step-detail"><summary>整卷原题</summary><p class="operation-prompt">${esc(op.intro)}</p><ul class="full-list">${op.requirements.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></details>
      <details class="step-detail"><summary>单独下载与参考</summary>
        <div class="reference-files">
          <a href="${asset(op,'starter.docx')}" download="${esc(op.title)}-练习文档.docx">Word 练习文档</a>
          <a href="${asset(op,'answer.docx')}" download="${esc(op.filename)}">参考成品</a>
          ${op.rubric?`<a href="${asset(op,'rubric.docx')}" download="${esc(op.title)}-评分说明.docx">原评分说明</a>`:''}
        </div>${references(op)}
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
    openDialog('答题卡',`<div class="dialog-scroll"><div class="answer-grid">${queue.map((q,i)=>button('jump',i+1,state.wrong[dedupKey(q)]?'no':state.seen[q.id]?'ok':'',`data-index="${i}" aria-label="跳至第 ${i+1} 题" ${i===current?'aria-current="true"':''}`)).join('')}</div></div>`);
  }
  function showSettings() {
    const question=route==='quiz'?queue[current]:null;
    const starred=question && !!state.stars[dedupKey(question)];
    const fields=route==='quiz'?`<div class="filters">
      <label>年份${select('year','年份',[['all','全部年份'],...years.map(y=>[y,y+' 年'])],state.year)}</label>
      <label>题型${select('kind','题型',[['all','全部题型'],...optionsFor(['单选','不定项','判断'])],state.kind)}</label>
      <label>顺序${select('order','练习顺序',[['original','原卷顺序'],['random','随机'],['wrong','错题'],['stars','收藏']],state.order)}</label>
      <label>知识点${select('topic','知识点',[['all','全部知识点'],...optionsFor(Object.keys(topics))],state.topic)}</label>
    </div>`:'';
    openDialog('练习设置',`${fields}<div class="settings-actions">
      ${question?button('favorite',starred?'取消收藏':'收藏本题','button secondary',`aria-pressed="${starred}"`):''}
      ${button('notebook','学习笔记','button secondary')}
      ${button('record','学习记录','button secondary')}
    </div>`);
  }
  function showStepMap() {
    const op=activeCase();
    const steps=op.steps.map(([name],i)=>{
      const mark=stepStatus(op,i);
      return button('step',`<span class="step-index ${mark}">${mark==='done'?'✓':mark==='review'?'↺':i+1}</span><span>${esc(name)}</span>`,'step-link',`data-index="${i}" ${i===currentStep(op)?'aria-current="step"':''}`);
    });
    openDialog('步骤目录',`<div class="step-links">${steps.join('')}</div>`);
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
      case 'settings': showSettings(); break;
      case 'favorite': {
        if (!queue[current]) return;
        const key=dedupKey(queue[current]);
        if(state.stars[key])delete state.stars[key];else state.stars[key]=true;
        if(state.order==='stars' && !state.stars[key]){
          selection=[];
          result=null;
          refreshQueue();
          renderQuizQuestion();
          showSettings();
        } else {
          target.setAttribute('aria-pressed',String(!!state.stars[key]));
          target.textContent=state.stars[key]?'取消收藏':'收藏本题';
        }
        save();
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
      case 'step-map': showStepMap(); break;
      case 'step': dialog.close(); moveStep(index); break;
      case 'step-prev': moveStep(currentStep(activeCase())-1); break;
      case 'step-next': moveStep(currentStep(activeCase())+1); break;
      case 'step-mark': {
        const op=activeCase();
        const mark=stepStatus(op,currentStep(op));
        openDialog('标记这一步',`<div class="settings-actions">
          ${button('mark-done','已掌握','button',`aria-pressed="${mark==='done'}"`)}
          ${button('mark-review','待重练','button secondary',`aria-pressed="${mark==='review'}"`)}
        </div>`);
        break;
      }
      case 'mark-review':
      case 'mark-done': {
        const op=activeCase();
        const i=currentStep(op);
        const mark=action==='mark-done'?'done':'review';
        state.mastered[op.id+'-'+i]=mark;
        dialog.close();
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
        revealFeedback(content.querySelector('.recall .feedback'));
        break;
      }
      case 'timer': {
        const op=activeCase();
        const timer=state.timers[op.id] ||= {accumulated:0,started:0};
        if(timer.started){timer.accumulated=elapsed(op);timer.started=0;}
        else timer.started=Date.now();
        save();
        target.querySelector('[data-timer-label]').textContent=timer.started?'暂停':'继续';
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
      showSettings();
      dialog.querySelector(`select[name="${input.name}"]`)?.focus({preventScroll:true});
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
