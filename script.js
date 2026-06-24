// Wumpus World V3 Game Logic

// --- AUDIO SYNTHESIZER ---
const AudioEngine = {
    ctx: null, soundEnabled: true,
    init() { 
        if (!this.ctx) { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        if (this.ctx && this.ctx.state === 'suspended') { this.ctx.resume(); }
    },
    playTone(freq, type, duration, vol=0.1) {
        if (!this.soundEnabled || !this.ctx) return;
        const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + duration);
    },
    playNoise(duration, vol=0.1, type='lowpass', freq=400) {
        if (!this.soundEnabled || !this.ctx) return;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource(); noise.buffer = buffer;
        const gain = this.ctx.createGain(); const filter = this.ctx.createBiquadFilter();
        filter.type = type; filter.frequency.value = freq;
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
        noise.start();
    },
    move() { this.playTone(400, 'sine', 0.1, 0.05); },
    bump() { this.playTone(150, 'sawtooth', 0.2, 0.1); },
    grab() { this.playTone(800, 'sine', 0.1, 0.1); setTimeout(() => this.playTone(1200, 'sine', 0.2, 0.1), 100); },
    shoot() { this.playTone(600, 'triangle', 0.1, 0.1); setTimeout(() => this.playNoise(0.3, 0.2, 'highpass', 1000), 100); },
    scream() { this.playTone(200, 'sawtooth', 0.5, 0.2); setTimeout(() => this.playTone(150, 'sawtooth', 0.5, 0.2), 200); },
    death() { this.playTone(100, 'sawtooth', 1, 0.3); this.playNoise(1, 0.3); },
    win() { [400, 500, 600, 800].forEach((freq, i) => setTimeout(() => this.playTone(freq, 'square', 0.2, 0.1), i * 150)); },
    wind() { this.playNoise(0.5, 0.05); },
    growl() { this.playTone(80, 'sawtooth', 0.5, 0.1); },
    bat() { this.playTone(800, 'triangle', 0.1, 0.1); setTimeout(() => this.playTone(1000, 'triangle', 0.1, 0.1), 100); }
};

// --- FX PARTICLE ENGINE ---
const FX = {
    canvas: document.getElementById('fx-canvas'), ctx: null, particles: [], active: true,
    init() {
        this.ctx = this.canvas.getContext('2d');
        const resize = () => {
            const rect = DOM.boardWrapper.getBoundingClientRect();
            this.canvas.width = rect.width; this.canvas.height = rect.height;
        };
        window.addEventListener('resize', resize); resize();
        this.loop();
    },
    loop() {
        if(!this.active) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for(let i = this.particles.length-1; i>=0; i--) {
            let p = this.particles[i];
            p.x += p.vx; p.y += p.vy; p.life--; p.alpha = p.life / p.maxLife;
            this.ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
            this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); this.ctx.fill();
            if(p.life <= 0) this.particles.splice(i, 1);
        }
        requestAnimationFrame(() => this.loop());
    },
    emit(type, r, c) {
        const cellStyles = getComputedStyle(document.documentElement);
        const cellSize = parseInt(cellStyles.getPropertyValue('--cell-size')) || 80;
        const gap = parseInt(cellStyles.getPropertyValue('--cell-gap')) || 8;
        const pad = parseInt(cellStyles.getPropertyValue('--board-padding')) || 16;
        const x = pad + (c * (cellSize + gap)) + (cellSize / 2);
        const y = pad + (r * (cellSize + gap)) + (cellSize / 2);
        
        let count = 0, color = '', speed = 0, size = 0, life = 0;
        if(type === 'gold') { count = 15; color = '251,191,36'; speed = 2; size = 3; life = 30; }
        else if(type === 'blood') { count = 40; color = '239,68,68'; speed = 5; size = 4; life = 40; }
        else if(type === 'dust') { count = 10; color = '148,163,184'; speed = 1; size = 2; life = 20; }
        
        for(let i=0; i<count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const s = Math.random() * speed;
            this.particles.push({
                x, y, vx: Math.cos(angle)*s, vy: Math.sin(angle)*s,
                color, size: Math.random()*size + 1, life: life, maxLife: life, alpha: 1
            });
        }
    }
};

// --- GAME STATE ---
let gridSize = 4;
let board = [];
let player = { r: 0, c: 0, dir: 0, arrows: 1, gold: 0, alive: true, hasWon: false };
let inventory = { rope: 0, torch: 0, potion: 0, map: 0 };
let wumpusAlive = true;
let score = 0;
let startTime = 0;
let playerTurns = 0;

let gameMode = 'sandbox'; // sandbox or campaign
let currentLevel = 1;
let aiActive = false;
let aiInterval = null;

const CAMPAIGN_LEVELS = [
    { size: 4, type: 'grid', title: "Level 1: The Wumpus", narrative: "Your first hunt. Beware the stench.", wumpus:1, pits:0, bats:0, gold:1, arrows:1, items:['torch'] },
    { size: 5, type: 'grid', title: "Level 2: Watch Your Step", narrative: "The Wumpus has dug pits. Feel for breezes.", wumpus:1, pits:3, bats:0, gold:1, arrows:1, items:['rope'] },
    { size: 6, type: 'organic', title: "Level 3: The Organic Cave", narrative: "A winding, natural cave. Stay sharp.", wumpus:1, pits:4, bats:1, gold:1, arrows:2, items:['torch','rope','potion'] },
    { size: 8, type: 'organic', title: "Level 4: The Abyss", narrative: "A massive labyrinth. Good luck.", wumpus:1, pits:8, bats:2, gold:2, arrows:3, items:['torch','rope','rope','map'] }
];

const DOM = {
    app: document.getElementById('app'), board: document.getElementById('game-board'),
    boardWrapper: document.getElementById('board-wrapper'), controls: document.getElementById('controls-panel'),
    arrows: document.getElementById('stat-arrows'), gold: document.getElementById('stat-gold'), score: document.getElementById('stat-score'),
    percepts: document.getElementById('percepts-display'), log: document.getElementById('game-log'),
    modal: document.getElementById('game-modal'), modalTitle: document.getElementById('modal-title'), modalMsg: document.getElementById('modal-message'),
    difficulty: document.getElementById('difficulty'), mode: document.getElementById('game-mode'), caveType: document.getElementById('cave-type'),
    btnAi: document.getElementById('btn-ai'), invTorch: document.getElementById('inv-torch'), invRope: document.getElementById('inv-rope'),
    invPotion: document.getElementById('inv-potion'), invMap: document.getElementById('inv-map'),
    highscores: document.getElementById('highscore-list'),
    btnHelp: document.getElementById('btn-help'), helpModal: document.getElementById('help-modal'), closeHelpBtn: document.getElementById('close-help-btn')
};

// --- HIGH SCORES ---
function loadHighScores() {
    if (gameMode === 'campaign') { DOM.highscores.innerHTML = '<div class="hs-entry">N/A in Campaign</div>'; return; }
    const diff = DOM.difficulty.value;
    const scores = JSON.parse(localStorage.getItem(`wumpus_scores_${diff}`)) || [];
    DOM.highscores.innerHTML = '';
    if (scores.length === 0) { DOM.highscores.innerHTML = '<div class="hs-entry">No scores yet!</div>'; return; }
    scores.forEach((s, i) => {
        const div = document.createElement('div'); div.className = 'hs-entry';
        div.innerHTML = `<span>#${i+1} Score: ${s.score}</span><span>${s.time}s</span>`;
        DOM.highscores.appendChild(div);
    });
}

function saveHighScore(finalScore, finalTime) {
    if (gameMode === 'campaign') return;
    const diff = DOM.difficulty.value;
    let scores = JSON.parse(localStorage.getItem(`wumpus_scores_${diff}`)) || [];
    scores.push({ score: finalScore, time: finalTime });
    scores.sort((a, b) => b.score - a.score || a.time - b.time);
    scores = scores.slice(0, 5);
    localStorage.setItem(`wumpus_scores_${diff}`, JSON.stringify(scores));
    loadHighScores();
}

// --- CORE LOGIC ---
function initGame() {
    AudioEngine.init(); FX.init();
    stopAI();
    
    gameMode = DOM.mode.value;
    let conf = { size: 4, type: 'grid', pits: 2, bats: 1, items: [] };
    
    if (gameMode === 'campaign') {
        if(currentLevel > CAMPAIGN_LEVELS.length) currentLevel = 1; // Win reset
        let lvl = CAMPAIGN_LEVELS[currentLevel-1];
        conf.size = lvl.size; conf.type = lvl.type; conf.pits = lvl.pits; conf.bats = lvl.bats; conf.items = lvl.items;
        player.arrows = lvl.arrows;
        DOM.difficulty.style.display = 'none'; DOM.caveType.style.display = 'none';
        document.querySelector('label[for="difficulty"]').style.display = 'none';
        document.querySelector('label[for="cave-type"]').style.display = 'none';
        document.getElementById('subtitle').textContent = `${lvl.title} - ${lvl.narrative}`;
    } else {
        currentLevel = 1;
        DOM.difficulty.style.display = 'inline-block'; DOM.caveType.style.display = 'inline-block';
        document.querySelector('label[for="difficulty"]').style.display = 'inline-block';
        document.querySelector('label[for="cave-type"]').style.display = 'inline-block';
        document.getElementById('subtitle').textContent = "Hunt the Wumpus, find the Gold, escape alive.";
        
        const diff = DOM.difficulty.value;
        if (diff === 'easy') { conf.size = 4; player.arrows = 1; conf.pits = 2; conf.bats = 1; conf.items = ['torch','map']; }
        else if (diff === 'medium') { conf.size = 6; player.arrows = 2; conf.pits = 5; conf.bats = 2; conf.items = ['torch','rope','potion']; }
        else if (diff === 'hard') { conf.size = 8; player.arrows = 3; conf.pits = 10; conf.bats = 3; conf.items = ['torch','rope','rope','potion','map']; }
        conf.type = DOM.caveType.value;
    }
    
    gridSize = conf.size;
    document.documentElement.style.setProperty('--grid-size', gridSize);
    
    board = [];
    player = { r: gridSize-1, c: 0, dir: 0, arrows: player.arrows, gold: 0, alive: true, hasWon: false };
    inventory = { rope: 0, torch: 0, potion: 0, map: 0 };
    wumpusAlive = true; score = 0; startTime = Date.now(); playerTurns = 0;
    
    DOM.modal.classList.add('hidden');
    DOM.boardWrapper.classList.add('torch-active');
    
    loadHighScores();
    generateBoard(conf);
    renderBoard();
    updateStatus();
    updateInventory();
    logMsg(`Game started. You are at entrance.`, true);
}

function generateBoard(conf) {
    for (let r = 0; r < gridSize; r++) {
        let row = [];
        for (let c = 0; c < gridSize; c++) {
            row.push({ isWall: false, hasWumpus: false, hasPit: false, hasBat: false, hasGold: false, hasItem: null, revealed: false, visited: false, breeze: false, stench: false, flap: false });
        }
        board.push(row);
    }
    
    const sr = gridSize - 1, sc = 0;
    
    if (conf.type === 'organic') {
        // Simple organic carve out
        for(let r=0; r<gridSize; r++) for(let c=0; c<gridSize; c++) board[r][c].isWall = true;
        let cr=sr, cc=sc;
        board[cr][cc].isWall = false;
        let carved = 1;
        const targetCarve = Math.floor((gridSize*gridSize) * 0.7); // 70% walkable
        while(carved < targetCarve) {
            const dir = Math.floor(Math.random()*4);
            if(dir===0 && cc<gridSize-1) cc++; else if(dir===1 && cr>0) cr--; else if(dir===2 && cc>0) cc--; else if(dir===3 && cr<gridSize-1) cr++;
            if(board[cr][cc].isWall) { board[cr][cc].isWall = false; carved++; }
        }
    }

    board[sr][sc].revealed = true; board[sr][sc].visited = true;

    function getRandomCell() {
        let r, c;
        do {
            r = Math.floor(Math.random() * gridSize); c = Math.floor(Math.random() * gridSize);
        } while (board[r][c].isWall || (r===sr && c===sc) || (r===sr && c===sc+1) || (r===sr-1 && c===sc) || board[r][c].hasWumpus || board[r][c].hasPit || board[r][c].hasBat || board[r][c].hasGold || board[r][c].hasItem);
        return {r, c};
    }

    let w = getRandomCell(); board[w.r][w.c].hasWumpus = true;
    let g = getRandomCell(); board[g.r][g.c].hasGold = true;

    let pitsPlaced = 0;
    while(pitsPlaced < conf.pits) {
        let p = getRandomCell(); board[p.r][p.c].hasPit = true; pitsPlaced++;
    }
    
    let batsPlaced = 0;
    while(batsPlaced < conf.bats) {
        let b = getRandomCell(); board[b.r][b.c].hasBat = true; batsPlaced++;
    }
    
    conf.items.forEach(item => {
        let i = getRandomCell(); board[i.r][i.c].hasItem = item;
    });

    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            if (board[r][c].hasWumpus) setAdjacent(r, c, 'stench');
            if (board[r][c].hasPit) setAdjacent(r, c, 'breeze');
            if (board[r][c].hasBat) setAdjacent(r, c, 'flap');
        }
    }
}

function setAdjacent(r, c, prop) {
    [[r-1,c], [r+1,c], [r,c-1], [r,c+1]].forEach(([ar,ac]) => {
        if(ar>=0 && ar<gridSize && ac>=0 && ac<gridSize && !board[ar][ac].isWall) board[ar][ac][prop] = true;
    });
}

function recalculatePercepts() {
    for(let r=0; r<gridSize; r++) {
        for(let c=0; c<gridSize; c++) {
            board[r][c].stench = false;
            board[r][c].breeze = false;
            board[r][c].flap = false;
        }
    }
    for(let r=0; r<gridSize; r++) {
        for(let c=0; c<gridSize; c++) {
            if(board[r][c].hasWumpus) setAdjacent(r, c, 'stench');
            if(board[r][c].hasPit) setAdjacent(r, c, 'breeze');
            if(board[r][c].hasBat) setAdjacent(r, c, 'flap');
        }
    }
}

function updateTorchlight() {
    if (!player.alive && !player.hasWon) { DOM.boardWrapper.classList.remove('torch-active'); return; }
    const cssVars = getComputedStyle(document.documentElement);
    const cellSize = parseInt(cssVars.getPropertyValue('--cell-size'));
    const gap = parseInt(cssVars.getPropertyValue('--cell-gap'));
    const pad = parseInt(cssVars.getPropertyValue('--board-padding'));
    
    const x = pad + (player.c * (cellSize + gap)) + (cellSize / 2);
    const y = pad + (player.r * (cellSize + gap)) + (cellSize / 2);
    
    document.documentElement.style.setProperty('--torch-x', `${x}px`);
    document.documentElement.style.setProperty('--torch-y', `${y}px`);
    document.documentElement.style.setProperty('--torch-radius', inventory.torch > 0 ? '200px' : '120px');
}

function renderBoard() {
    DOM.board.innerHTML = '';
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            const d = board[r][c];
            const div = document.createElement('div');
            div.className = 'cell';
            if (d.isWall) div.classList.add('wall');
            else if (!d.revealed) div.classList.add('fog');
            else if (d.revealed) div.classList.add('revealed');
            
            if (d.visited) div.classList.add('visited');
            
            if (!d.isWall && (d.revealed || !player.alive || player.hasWon)) {
                if (d.hasPit) div.innerHTML += '<div class="entity pit"></div>';
                if (d.hasBat) div.innerHTML += '<div class="entity bat"></div>';
                if (d.hasWumpus && wumpusAlive) div.innerHTML += `<div class="entity wumpus ${gameMode==='sandbox' ? 'roaming':''}"></div>`;
                if (d.hasWumpus && !wumpusAlive) div.innerHTML += '<div class="entity wumpus dead"></div>';
                if (d.hasGold) div.innerHTML += '<div class="entity gold"></div>';
                if (d.hasItem === 'torch') div.innerHTML += '<div class="entity item-torch"></div>';
                if (d.hasItem === 'rope') div.innerHTML += '<div class="entity item-rope"></div>';
                if (d.hasItem === 'potion') div.innerHTML += '<div class="entity item-potion"></div>';
                if (d.hasItem === 'map') div.innerHTML += '<div class="entity item-map"></div>';
                if (d.breeze) div.innerHTML += '<div class="breeze"></div>';
                if (d.stench && wumpusAlive) div.innerHTML += '<div class="stench"></div>';
                if (d.flap) div.innerHTML += '<div class="flap"></div>';
            }

            if (player.r === r && player.c === c && player.alive) {
                div.innerHTML += `<div class="entity player dir-${player.dir}"></div>`;
            }
            DOM.board.appendChild(div);
        }
    }
    updateTorchlight();
}

function updateStatus(bump = false, scream = false) {
    DOM.arrows.textContent = player.arrows;
    DOM.gold.textContent = player.gold;
    DOM.score.textContent = score;

    const cell = board[player.r][player.c];
    DOM.percepts.innerHTML = ''; let hp = false;

    if (cell.stench && wumpusAlive) { addPercept('stench', 'Stench! The Wumpus is near.'); AudioEngine.growl(); hp = true; }
    if (cell.breeze) { addPercept('breeze', 'Breeze! Drafty...'); AudioEngine.wind(); hp = true; }
    if (cell.flap) { addPercept('flap', 'Flap! Hear wings flutter...'); hp = true; }
    if (cell.hasGold) { addPercept('glitter', 'Glitter! I see shiny gold!'); FX.emit('gold', player.r, player.c); hp = true; }
    if (cell.hasItem) { addPercept('glitter', `You see a ${cell.hasItem}!`); hp=true; }
    if (bump) { addPercept('bump', 'Ouch! Bumped a wall.'); AudioEngine.bump(); hp = true; }
    if (scream) { addPercept('scream', 'SCREAM! Wumpus killed!'); hp = true; }
    if (!hp) addPercept('empty', 'It is quiet...');
}

function updateInventory() {
    DOM.invTorch.querySelector('.qty').textContent = inventory.torch;
    if(inventory.torch > 0) DOM.invTorch.classList.remove('empty'); else DOM.invTorch.classList.add('empty');
    
    DOM.invRope.querySelector('.qty').textContent = inventory.rope;
    if(inventory.rope > 0) DOM.invRope.classList.remove('empty'); else DOM.invRope.classList.add('empty');
    
    DOM.invPotion.querySelector('.qty').textContent = inventory.potion;
    if(inventory.potion > 0) DOM.invPotion.classList.remove('empty'); else DOM.invPotion.classList.add('empty');
    
    DOM.invMap.querySelector('.qty').textContent = inventory.map;
    if(inventory.map > 0) DOM.invMap.classList.remove('empty'); else DOM.invMap.classList.add('empty');
}

function addPercept(type, msg) {
    const p = document.createElement('div'); p.className = `percept ${type}`; p.textContent = msg; DOM.percepts.appendChild(p);
}

function logMsg(msg, clear = false) {
    if (clear) DOM.log.innerHTML = '';
    const p = document.createElement('p'); p.textContent = `> ${msg}`; DOM.log.appendChild(p);
    DOM.log.scrollTop = DOM.log.scrollHeight;
}

// --- ACTIONS ---
function moveWumpus() {
    // Shifting disabled per user request
}

function move(dr, dc, newDir) {
    if (!player.alive || player.hasWon) return;
    player.dir = newDir;
    let nr = player.r + dr, nc = player.c + dc;

    if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize && !board[nr][nc].isWall) {
        player.r = nr; player.c = nc; score -= 1; 
        board[nr][nc].revealed = true; board[nr][nc].visited = true;
        logMsg(`Moved to (${nc+1},${gridSize-nr})`);
        AudioEngine.move();
        FX.emit('dust', nr, nc);
        
        checkCell();
    } else {
        DOM.boardWrapper.classList.add('shake'); setTimeout(() => DOM.boardWrapper.classList.remove('shake'), 400);
        updateStatus(true, false); logMsg("Bumped into wall.");
    }
    renderBoard();
}

function checkCell() {
    const cell = board[player.r][player.c];
    if (cell.hasBat) {
        logMsg("Super Bats grabbed you!"); AudioEngine.bat();
        let r, c;
        do { r = Math.floor(Math.random() * gridSize); c = Math.floor(Math.random() * gridSize); } 
        while (board[r][c].isWall || board[r][c].hasWumpus || board[r][c].hasPit || board[r][c].hasBat || board[r][c].hasGold);
        player.r = r; player.c = c; board[r][c].revealed = true; board[r][c].visited = true;
        logMsg(`Dropped at (${c+1},${gridSize-r})`); checkCell(); return;
    }
    
    if (cell.hasPit) {
        if(inventory.rope > 0) {
            inventory.rope--; logMsg("Fell in pit! Used Rope to climb out!");
            updateInventory(); score -= 50;
            player.alive = true;
            cell.hasPit = false; // Destroy pit
            recalculatePercepts(); // Clear breeezes for the destroyed pit
            updateStatus();
        } else {
            player.alive = false; score -= 1000; logMsg("Fell into a pit!"); AudioEngine.death();
            gameOver(false, "You fell into a bottomless pit.");
        }
    } else if (cell.hasWumpus && wumpusAlive) {
        if(inventory.potion > 0) {
            inventory.potion--; logMsg("Wumpus attacked! Potion saved you!"); updateInventory();
            player.alive = true; // bounce back
            if(player.dir===0) player.c--; else if(player.dir===90) player.r++; else if(player.dir===180) player.c++; else if(player.dir===270) player.r--;
        } else {
            player.alive = false; score -= 1000; logMsg("Eaten by the Wumpus."); FX.emit('blood', player.r, player.c); AudioEngine.death();
            gameOver(false, "You were eaten by the Wumpus.");
        }
    } else {
        updateStatus();
    }
}

function shootArrow() {
    if (!player.alive || player.hasWon || player.arrows <= 0) return;
    player.arrows--; score -= 10; logMsg("Fired arrow..."); AudioEngine.shoot();

    let dr = 0, dc = 0;
    if (player.dir === 0) dc = 1; else if (player.dir === 90) dr = -1;
    else if (player.dir === 180) dc = -1; else if (player.dir === 270) dr = 1;

    let hit = false, tr = player.r + dr, tc = player.c + dc;
    while (tr >= 0 && tr < gridSize && tc >= 0 && tc < gridSize && !board[tr][tc].isWall) {
        if (board[tr][tc].hasWumpus) { wumpusAlive = false; hit = true; FX.emit('blood', tr, tc); break; }
        tr += dr; tc += dc;
    }

    if (hit) { logMsg("SCREAM!"); AudioEngine.scream(); updateStatus(false, true); } 
    else { logMsg("Missed."); updateStatus(); }
    
    renderBoard();
}

function grabItem() {
    if (!player.alive || player.hasWon) return;
    const cell = board[player.r][player.c];
    if (cell.hasGold) {
        player.gold++; cell.hasGold = false; logMsg("Grabbed Gold!"); AudioEngine.grab();
    } else if (cell.hasItem) {
        if(cell.hasItem === 'map') {
            logMsg("Read Magic Map! Revealed 3 safe rooms."); AudioEngine.grab(); cell.hasItem = null;
            let unv = [];
            for(let r=0; r<gridSize; r++) for(let c=0; c<gridSize; c++) if(!board[r][c].isWall && !board[r][c].hasWumpus && !board[r][c].hasPit && !board[r][c].hasBat && !board[r][c].revealed) unv.push({r,c});
            unv.sort(()=>Math.random()-0.5).slice(0,3).forEach(u => board[u.r][u.c].revealed = true);
        } else {
            inventory[cell.hasItem]++; logMsg(`Grabbed ${cell.hasItem}!`); AudioEngine.grab(); cell.hasItem = null;
            updateInventory();
        }
    } else { logMsg("Nothing here."); }
    updateStatus(); renderBoard();
}

function climbOut() {
    if (!player.alive || player.hasWon) return;
    if (player.r === gridSize - 1 && player.c === 0) {
        if (player.gold > 0) {
            score += 1000; player.hasWon = true; AudioEngine.win();
            if(gameMode === 'campaign' && currentLevel < CAMPAIGN_LEVELS.length) {
                currentLevel++; logMsg(`Level Complete! Proceeding to level ${currentLevel}...`);
                setTimeout(initGame, 3000);
            } else {
                const timeTaken = Math.floor((Date.now() - startTime) / 1000);
                saveHighScore(score, timeTaken);
                gameOver(true, `You escaped with the Gold! Score: ${score} (Time: ${timeTaken}s)`);
            }
        } else {
            logMsg("You cowardly left without gold."); player.alive = false; AudioEngine.death();
            gameOver(false, "You coward! You left without the Gold.");
        }
    } else { logMsg("Can only climb out at start!"); }
}

function gameOver(win, msg) {
    stopAI();
    DOM.modalTitle.textContent = win ? (gameMode==='campaign' ? "Campaign Complete!" : "Victory!") : "Game Over";
    DOM.modalMsg.textContent = msg;
    DOM.modal.querySelector('.modal-content').className = `modal-content ${win ? 'win' : 'lose'}`;
    for(let r=0; r<gridSize; r++) for(let c=0; c<gridSize; c++) board[r][c].revealed = true;
    renderBoard(); setTimeout(() => DOM.modal.classList.remove('hidden'), 1000);
}

// --- AI AUTO-SOLVER ---
function toggleAI() {
    aiActive = !aiActive;
    if(aiActive) {
        DOM.btnAi.classList.add('active'); DOM.btnAi.textContent = "🤖 Stop AI";
        DOM.controls.classList.add('disabled');
        aiInterval = setInterval(aiStep, 500); // 500ms delay to watch
    } else {
        stopAI();
    }
}

function stopAI() {
    aiActive = false; clearInterval(aiInterval);
    DOM.btnAi.classList.remove('active'); DOM.btnAi.textContent = "🤖 Auto-Play (AI)";
    DOM.controls.classList.remove('disabled');
}

function aiStep() {
    if(!player.alive || player.hasWon) { stopAI(); return; }
    
    // 1. Grab gold or items if present
    const c = board[player.r][player.c];
    if(c.hasGold || c.hasItem) { grabItem(); return; }
    
    // 2. Climb out if have gold and at start
    if(player.gold > 0 && player.r === gridSize-1 && player.c === 0) { climbOut(); return; }
    
    // Logic: Find unvisited safe cells adjacent to visited cells
    let safeUnvisited = [];
    
    // Basic AI Knowledge Base builder
    for(let r=0; r<gridSize; r++) {
        for(let c=0; c<gridSize; c++) {
            if(board[r][c].visited) {
                // If visited, check neighbors
                [[r-1,c], [r+1,c], [r,c-1], [r,c+1]].forEach(([nr,nc]) => {
                    if(nr>=0 && nr<gridSize && nc>=0 && nc<gridSize && !board[nr][nc].isWall && !board[nr][nc].visited) {
                        let isSafe = true;
                        // A neighbor is safe if ALL adjacent visited cells have NO breeze, NO stench, NO flap
                        [[nr-1,nc], [nr+1,nc], [nr,nc-1], [nr,nc+1]].forEach(([nnr,nnc]) => {
                            if(nnr>=0 && nnr<gridSize && nnc>=0 && nnc<gridSize && board[nnr][nnc].visited) {
                                if(board[nnr][nnc].breeze || (board[nnr][nnc].stench && wumpusAlive) || board[nnr][nnc].flap) isSafe = false;
                            }
                        });
                        
                        if(isSafe && !safeUnvisited.some(el => el.r===nr && el.c===nc)) {
                            safeUnvisited.push({r:nr, c:nc});
                        }
                    }
                });
            }
        }
    }
    
    // Route to nearest target (BFS)
    function getPathTo(targets) {
        if(targets.length === 0) return null;
        let queue = [{r: player.r, c: player.c, path: []}];
        let visited = new Set([`${player.r},${player.c}`]);
        
        while(queue.length > 0) {
            let curr = queue.shift();
            if(targets.some(t => t.r === curr.r && t.c === curr.c)) return curr.path;
            
            [[curr.r-1,curr.c,90], [curr.r+1,curr.c,270], [curr.r,curr.c-1,180], [curr.r,curr.c+1,0]].forEach(([nr,nc,dir]) => {
                if(nr>=0 && nr<gridSize && nc>=0 && nc<gridSize && !board[nr][nc].isWall) {
                    // AI only traverses visited cells to reach safe unvisited
                    if(board[nr][nc].visited || targets.some(t=>t.r===nr && t.c===nc)) {
                        let key = `${nr},${nc}`;
                        if(!visited.has(key)) {
                            visited.add(key);
                            queue.push({r:nr, c:nc, path: [...curr.path, {dr: nr-curr.r, dc: nc-curr.c, dir: dir}]});
                        }
                    }
                }
            });
        }
        return null;
    }

    // Goal Priority: 
    // 1. If have gold, path to entrance.
    if(player.gold > 0) {
        let path = getPathTo([{r: gridSize-1, c: 0}]);
        if(path && path.length>0) { move(path[0].dr, path[0].dc, path[0].dir); return; }
    }
    
    // 2. Explore safe unvisited
    if(safeUnvisited.length > 0) {
        let path = getPathTo(safeUnvisited);
        if(path && path.length>0) { move(path[0].dr, path[0].dc, path[0].dir); return; }
    }
    
    // 3. If stuck, guess (Simplistic AI fallback: pick random unvisited neighbor of a visited cell)
    let unknownNeighbors = [];
    for(let r=0; r<gridSize; r++) {
        for(let c=0; c<gridSize; c++) {
            if(board[r][c].visited) {
                [[r-1,c,90], [r+1,c,270], [r,c-1,180], [r,c+1,0]].forEach(([nr,nc,dir]) => {
                    if(nr>=0 && nr<gridSize && nc>=0 && nc<gridSize && !board[nr][nc].isWall && !board[nr][nc].visited) {
                        unknownNeighbors.push({r, c, dr: nr-r, dc: nc-c, dir}); // Path from r,c
                    }
                });
            }
        }
    }
    
    if(unknownNeighbors.length > 0) {
        let target = unknownNeighbors[0];
        if(player.r === target.r && player.c === target.c) { move(target.dr, target.dc, target.dir); } 
        else {
            let path = getPathTo([{r: target.r, c: target.c}]);
            if(path && path.length>0) { move(path[0].dr, path[0].dc, path[0].dir); }
        }
    } else {
        logMsg("AI is completely stuck. No moves found."); stopAI();
    }
}

// --- CONTROLS ---
document.addEventListener('keydown', (e) => {
    if(aiActive) return;
    AudioEngine.init();
    if (e.key === 'ArrowUp' || e.key === 'w') move(-1, 0, 90);
    else if (e.key === 'ArrowDown' || e.key === 's') move(1, 0, 270);
    else if (e.key === 'ArrowLeft' || e.key === 'a') move(0, -1, 180);
    else if (e.key === 'ArrowRight' || e.key === 'd') move(0, 1, 0);
    else if (e.key === 'f') shootArrow();
    else if (e.key === 'g') grabItem();
    else if (e.key === 'c') climbOut();
});

let tX = 0, tY = 0;
DOM.boardWrapper.addEventListener('touchstart', e => { tX = e.changedTouches[0].screenX; tY = e.changedTouches[0].screenY; }, {passive: true});
DOM.boardWrapper.addEventListener('touchend', e => {
    if(aiActive) return;
    AudioEngine.init(); if (!player.alive || player.hasWon) return;
    let dx = e.changedTouches[0].screenX - tX, dy = e.changedTouches[0].screenY - tY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) {
        if (Math.abs(dx) > Math.abs(dy)) { if (dx > 0) move(0, 1, 0); else move(0, -1, 180); } 
        else { if (dy > 0) move(1, 0, 270); else move(-1, 0, 90); }
    }
}, {passive: true});

const btn = (id, fn) => document.getElementById(id).addEventListener('click', () => { if(!aiActive || id==='btn-ai' || id==='btn-restart') { AudioEngine.init(); fn(); }});
btn('btn-up', () => move(-1, 0, 90)); btn('btn-down', () => move(1, 0, 270)); btn('btn-left', () => move(0, -1, 180)); btn('btn-right', () => move(0, 1, 0));
btn('btn-shoot', shootArrow); btn('btn-grab', grabItem); btn('btn-climb', climbOut); btn('btn-restart', initGame); btn('modal-btn', initGame);

if (DOM.btnAi) DOM.btnAi.addEventListener('click', () => { AudioEngine.init(); toggleAI(); });
if (DOM.btnHelp) DOM.btnHelp.addEventListener('click', () => { AudioEngine.init(); DOM.helpModal.classList.remove('hidden'); });
if (DOM.closeHelpBtn) DOM.closeHelpBtn.addEventListener('click', () => { DOM.helpModal.classList.add('hidden'); });
if (DOM.mode) DOM.mode.addEventListener('change', initGame); 
if (DOM.difficulty) DOM.difficulty.addEventListener('change', initGame); 
if (DOM.caveType) DOM.caveType.addEventListener('change', initGame);

const soundBtn = document.getElementById('btn-toggle-sound');
if (soundBtn) {
    soundBtn.addEventListener('click', function() {
        AudioEngine.soundEnabled = !AudioEngine.soundEnabled; 
        this.textContent = AudioEngine.soundEnabled ? '🔊' : '🔇';
    });
}

initGame();
