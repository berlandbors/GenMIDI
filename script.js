let notes = [];
let currentChord = [];
let audioContext = null;
let isPlaying = false;
let shouldStop = false;
let currentTimeouts = [];
let activeOscillators = [];
let tempo = 120;
let waveformType = 'sine';
let loopEnabled = false;

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast' + (isError ? ' error' : '');
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

function initAudio() {
    if (!audioContext) {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                throw new Error('Web Audio API не поддерживается');
            }
            audioContext = new AudioContextClass();
            
            if (audioContext.state === 'suspended') {
                const resumeAudio = () => {
                    audioContext.resume();
                    document.removeEventListener('click', resumeAudio);
                    document.removeEventListener('keydown', resumeAudio);
                };
                document.addEventListener('click', resumeAudio, { once: true });
                document.addEventListener('keydown', resumeAudio, { once: true });
            }
        } catch (error) {
            showToast('⚠️ Web Audio API не поддерживается', true);
            console.error('Audio init error:', error);
            return false;
        }
    }
    
    // Возобновляем контекст если он был приостановлен
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    return true;
}

function updateTempo(value) {
    tempo = parseInt(value);
    const tempoValue = document.getElementById('tempoValue');
    const currentTempo = document.getElementById('currentTempo');
    if (tempoValue) tempoValue.textContent = tempo + ' BPM';
    if (currentTempo) currentTempo.textContent = tempo;
    updateStats();
    saveToLocalStorage();
}

function updateWaveform(value) {
    waveformType = value;
    saveToLocalStorage();
}

function toggleLoop() {
    loopEnabled = !loopEnabled;
    const icon = document.getElementById('loopIcon');
    const btn = document.getElementById('loopBtn');
    
    if (icon) icon.textContent = loopEnabled ? '🔂' : '🔁';
    
    if (loopEnabled) {
        if (btn) btn.classList.add('loop-active');
        showToast('🔂 Повтор включен — мелодия будет играть бесконечно');
    } else {
        if (btn) btn.classList.remove('loop-active');
        showToast('🔁 Повтор выключен — мелодия сыграет один раз');
    }
    
    saveToLocalStorage();
}

function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function pluralizeCycles(count) {
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;
    
    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return count + ' циклов';
    }
    if (lastDigit === 1) {
        return count + ' цикл';
    }
    if (lastDigit >= 2 && lastDigit <= 4) {
        return count + ' цикла';
    }
    return count + ' циклов';
}

// ==================== АУДИО ВОСПРОИЗВЕДЕНИЕ ====================

function playNote(frequency, duration, velocity) {
    if (!initAudio()) return null;
    
    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.type = waveformType;
        oscillator.frequency.value = frequency;
        
        const volume = velocity / 127;
        gainNode.gain.value = volume * 0.3;
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
        
        // Отслеживаем активные осцилляторы
        activeOscillators.push(oscillator);
        oscillator.onended = () => {
            const index = activeOscillators.indexOf(oscillator);
            if (index > -1) {
                activeOscillators.splice(index, 1);
            }
        };
        
        return oscillator;
    } catch (error) {
        console.error('Ошибка воспроизведения:', error);
        return null;
    }
}

function playChord(noteArray, duration) {
    const oscillators = [];
    noteArray.forEach(noteData => {
        const frequency = midiToFrequency(noteData.note);
        const osc = playNote(frequency, duration, noteData.velocity);
        if (osc) oscillators.push(osc);
    });
    return oscillators;
}

async function playMelody() {
    if (notes.length === 0) {
        showToast('Добавьте ноты для воспроизведения', true);
        return;
    }
    
    if (isPlaying) {
        console.warn('⚠️ Уже воспроизводится');
        return;
    }
    
    // Блокируем сразу, чтобы избежать race condition
    isPlaying = true;
    shouldStop = false;
    
    if (!initAudio()) {
        isPlaying = false;
        showToast('Ошибка инициализации аудио', true);
        return;
    }
    
    const visualizer = document.getElementById('visualizer');
    const timeline = document.getElementById('timeline');
    const progressFill = document.getElementById('progressFill');
    const playBtn = document.getElementById('playBtn');
    const stopBtn = document.getElementById('stopBtn');
    const playerSection = document.getElementById('playerSection');
    
    if (playBtn) playBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (playerSection) playerSection.classList.add('playing');
    
    const quarterNoteDuration = 60 / tempo;
    const ticksPerQuarter = 96;
    
    updatePianoRoll();
    
    let loopCount = 0;
    const maxLoops = 1000;
    
    try {
        do {
            if (shouldStop) break;
            
            loopCount++;
            
            if (loopCount > maxLoops) {
                console.warn('Достигнут лимит повторов');
                showToast('⚠️ Достигнут лимит повторов (1000)', true);
                break;
            }
            
            currentTimeouts.forEach(timeout => clearTimeout(timeout));
            currentTimeouts = [];
            
            for (let i = 0; i < notes.length; i++) {
                if (shouldStop) break;
                
                const item = notes[i];
                const duration = (item.duration / ticksPerQuarter) * quarterNoteDuration;
                
                const progress = ((i + 1) / notes.length) * 100;
                if (progressFill) progressFill.style.width = progress + '%';
                
                const noteItems = document.querySelectorAll('.note-item');
                noteItems.forEach((elem, index) => {
                    elem.classList.toggle('playing', index === i);
                });
                
                if (item.isChord) {
                    playChord(item.notes, duration);
                    const noteNames = item.notes.map(n => n.noteText.split(' ')[0]).join(' + ');
                    if (visualizer) visualizer.innerHTML = `<span style="font-size: 48px;">🎹</span><br><span style="font-size: 18px;">${noteNames}</span>`;
                } else {
                    const frequency = midiToFrequency(item.note);
                    playNote(frequency, duration, item.velocity);
                    if (visualizer) visualizer.innerHTML = `<span style="font-size: 48px;">🎵</span><br><span style="font-size: 24px;">${item.noteText}</span>`;
                }
                
                const loopText = loopEnabled ? ` [${pluralizeCycles(loopCount)}]` : '';
                if (timeline) timeline.textContent = `Элемент ${i + 1} из ${notes.length}${loopText}`;
                
                const bars = document.querySelectorAll('.piano-bar');
                bars.forEach((bar, idx) => {
                    bar.classList.toggle('active', idx === i % bars.length);
                });
                
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, duration * 1000);
                    currentTimeouts.push(timeout);
                });
                
                if (shouldStop) break;
            }
            
            document.querySelectorAll('.note-item').forEach(item => {
                item.classList.remove('playing');
            });
            
            document.querySelectorAll('.piano-bar').forEach(bar => {
                bar.classList.remove('active');
            });
            
            if (loopEnabled && !shouldStop) {
                if (progressFill) progressFill.style.width = '0%';
                if (visualizer) visualizer.innerHTML = '<span style="font-size: 48px;">🔄</span><br><span style="font-size: 14px;">Повтор...</span>';
                
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, 500);
                    currentTimeouts.push(timeout);
                });
            }
            
        } while (loopEnabled && !shouldStop);
        
        if (!shouldStop) {
            showToast(`✅ Воспроизведение завершено (${loopEnabled ? pluralizeCycles(loopCount) : '1 раз'})`);
        }
        
    } catch (error) {
        console.error('Ошибка воспроизведения:', error);
        showToast('❌ Ошибка воспроизведения', true);
    } finally {
        isPlaying = false;
        shouldStop = false;
        
        currentTimeouts.forEach(timeout => clearTimeout(timeout));
        currentTimeouts = [];
        
        if (visualizer) visualizer.innerHTML = '<span>🎵</span>';
        if (timeline) timeline.textContent = '';
        if (progressFill) progressFill.style.width = '0%';
        
        if (playBtn) playBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (playerSection) playerSection.classList.remove('playing');
        
        document.querySelectorAll('.note-item').forEach(item => {
            item.classList.remove('playing');
        });
        
        document.querySelectorAll('.piano-bar').forEach(bar => {
            bar.classList.remove('active');
        });
    }
}

function stopMelody() {
    if (!isPlaying) {
        console.warn('⚠️ Ничего не воспроизводится');
        return;
    }
    
    console.log('🛑 Остановка воспроизведения...');
    
    shouldStop = true;
    
    currentTimeouts.forEach(timeout => clearTimeout(timeout));
    currentTimeouts = [];
    
    // Останавливаем все активные осцилляторы
    activeOscillators.forEach(osc => {
        try {
            osc.stop();
            osc.disconnect();
        } catch (e) {
            console.warn('Не удалось остановить осциллятор:', e);
        }
    });
    activeOscillators = [];
    
    showToast('⏹️ Воспроизведение остановлено');
}

// ==================== УПРАВЛЕНИЕ НОТАМИ ====================

function updatePianoRoll() {
    const pianoRoll = document.getElementById('pianoRoll');
    if (!pianoRoll) return;
    
    pianoRoll.innerHTML = '';
    
    const maxBars = Math.min(notes.length, 20);
    for (let i = 0; i < maxBars; i++) {
        const bar = document.createElement('div');
        bar.className = 'piano-bar';
        let avgVelocity;
        if (notes[i].isChord) {
            avgVelocity = notes[i].notes.reduce((sum, n) => sum + n.velocity, 0) / notes[i].notes.length;
        } else {
            avgVelocity = notes[i].velocity;
        }
        const height = (avgVelocity / 127) * 60;
        bar.style.height = height + 'px';
        pianoRoll.appendChild(bar);
    }
}

function addToChord() {
    const noteSelect = document.getElementById('noteSelect');
    const velocityInput = document.getElementById('velocity');
    
    if (!noteSelect || !velocityInput) return;
    
    const noteValue = parseInt(noteSelect.value);
    const noteText = noteSelect.options[noteSelect.selectedIndex].text;
    const velocity = parseInt(velocityInput.value);
    
    if (currentChord.some(n => n.note === noteValue)) {
        showToast('Эта нота уже в аккорде!', true);
        return;
    }
    
    currentChord.push({
        note: noteValue,
        noteText: noteText,
        velocity: velocity
    });
    
    updateChordDisplay();
    
    const frequency = midiToFrequency(noteValue);
    playNote(frequency, 0.3, velocity);
}

function removeFromChord(index) {
    currentChord.splice(index, 1);
    updateChordDisplay();
}

function clearChord() {
    currentChord = [];
    updateChordDisplay();
}

function updateChordDisplay() {
    const container = document.getElementById('chordNotes');
    if (!container) return;
    
    if (currentChord.length === 0) {
        container.innerHTML = '<span style="color: #999; font-size: 12px;">Нет нот в аккорде</span>';
    } else {
        container.innerHTML = currentChord.map((note, index) => `
            <div class="chord-note-tag">
                ${note.noteText.split(' ')[0]}
                <button onclick="removeFromChord(${index})" title="Удалить">×</button>
            </div>
        `).join('');
    }
}

function addChord() {
    if (currentChord.length === 0) {
        showToast('Добавьте ноты в аккорд!', true);
        return;
    }
    
    if (currentChord.length === 1) {
        showToast('В аккорде должно быть минимум 2 ноты', true);
        return;
    }
    
    const durationSelect = document.getElementById('duration');
    if (!durationSelect) return;
    
    const duration = parseInt(durationSelect.value);
    const durationText = durationSelect.options[durationSelect.selectedIndex].text;
    
    notes.push({
        isChord: true,
        notes: [...currentChord],
        duration: duration,
        durationText: durationText
    });
    
    const quarterNoteDuration = 60 / tempo;
    const ticksPerQuarter = 96;
    const durationSeconds = (duration / ticksPerQuarter) * quarterNoteDuration;
    playChord(currentChord, durationSeconds);
    
    showToast(`✅ Аккорд из ${currentChord.length} нот добавлен`);
    
    clearChord();
    updateNotesList();
    updateStats();
    saveToLocalStorage();
}

function addNote() {
    const noteSelect = document.getElementById('noteSelect');
    const durationSelect = document.getElementById('duration');
    const velocityInput = document.getElementById('velocity');
    
    if (!noteSelect || !durationSelect || !velocityInput) return;
    
    const noteValue = parseInt(noteSelect.value);
    const noteText = noteSelect.options[noteSelect.selectedIndex].text;
    const duration = parseInt(durationSelect.value);
    const durationText = durationSelect.options[durationSelect.selectedIndex].text;
    const velocity = parseInt(velocityInput.value);
    
    notes.push({
        isChord: false,
        note: noteValue,
        noteText: noteText,
        duration: duration,
        durationText: durationText,
        velocity: velocity
    });
    
    const frequency = midiToFrequency(noteValue);
    const quarterNoteDuration = 60 / tempo;
    const previewDuration = Math.min(0.5, (duration / 96) * quarterNoteDuration);
    playNote(frequency, previewDuration, velocity);
    
    updateNotesList();
    updateStats();
    saveToLocalStorage();
}

function deleteNote(index) {
    notes.splice(index, 1);
    showToast('🗑️ Элемент удален');
    updateNotesList();
    updateStats();
    saveToLocalStorage();
}

function previewNote(index) {
    const item = notes[index];
    const quarterNoteDuration = 60 / tempo;
    const ticksPerQuarter = 96;
    const duration = (item.duration / ticksPerQuarter) * quarterNoteDuration;
    
    if (item.isChord) {
        playChord(item.notes, duration);
    } else {
        const frequency = midiToFrequency(item.note);
        playNote(frequency, duration, item.velocity);
    }
}

function clearNotes() {
    if (notes.length === 0) return;
    
    if (confirm(`Удалить все ${notes.length} элементов?`)) {
        notes = [];
        showToast('🗑️ Все элементы удалены');
        updateNotesList();
        updateStats();
        saveToLocalStorage();
    }
}

function reverseNotes() {
    if (notes.length < 2) {
        showToast('Добавьте минимум 2 элемента', true);
        return;
    }
    
    notes.reverse();
    showToast('🔄 Список развернут');
    updateNotesList();
    saveToLocalStorage();
}

// ==================== UI ОБНОВЛЕНИЯ ====================

function updateStats() {
    const totalNotesElem = document.getElementById('totalNotes');
    const totalDurationElem = document.getElementById('totalDuration');
    
    const quarterNoteDuration = 60 / tempo;
    const ticksPerQuarter = 96;
    let totalSeconds = 0;
    
    notes.forEach(item => {
        totalSeconds += (item.duration / ticksPerQuarter) * quarterNoteDuration;
    });
    
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    
    if (totalNotesElem) totalNotesElem.textContent = notes.length;
    if (totalDurationElem) {
        totalDurationElem.textContent = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }
}

function updateNotesList() {
    const list = document.getElementById('notesList');
    const generateBtn = document.getElementById('generateBtn');
    const playBtn = document.getElementById('playBtn');
    const noteCount = document.getElementById('noteCount');
    
    if (!list) return;
    
    if (noteCount) noteCount.textContent = notes.length;
    
    if (notes.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <p>Нет добавленных нот</p>
                <p style="font-size: 14px; margin-top: 10px;">Добавьте ноты или выберите пресет</p>
            </div>
        `;
        if (generateBtn) generateBtn.disabled = true;
        if (playBtn) playBtn.disabled = true;
        const pianoRoll = document.getElementById('pianoRoll');
        if (pianoRoll) pianoRoll.innerHTML = '';
    } else {
        list.innerHTML = notes.map((item, index) => {
            let displayText;
            let durationStr = item.durationText.replace(/[🎵𝅗𝅥♩♪♬.]/g, '').trim();
            
            if (item.isChord) {
                const noteNames = item.notes.map(n => n.noteText.split(' ')[0]).join(', ');
                displayText = `<strong>🎹 ${noteNames}</strong>`;
            } else {
                displayText = `<strong>${item.noteText}</strong>`;
            }
            
            return `
                <div class="note-item ${item.isChord ? 'chord' : ''}" onclick="previewNote(${index})">
                    <div class="note-info">
                        <span class="note-number">${index + 1}</span>
                        ${displayText}
                        ${item.isChord ? '<span class="chord-indicator">' + item.notes.length + ' НОТ</span>' : ''}
                        <div class="note-details">
                            ${durationStr} ${!item.isChord ? `| Громкость: ${item.velocity}` : ''}
                        </div>
                    </div>
                    <div class="note-actions">
                        <button class="btn-preview" onclick="event.stopPropagation(); previewNote(${index})" title="Предпросмотр">▶️</button>
                        <button class="btn-delete" onclick="event.stopPropagation(); deleteNote(${index})" title="Удалить">✕</button>
                    </div>
                </div>
            `;
        }).join('');
        if (generateBtn) generateBtn.disabled = false;
        if (playBtn) playBtn.disabled = false;
        updatePianoRoll();
    }
}

// ==================== ПРЕСЕТЫ ====================

function loadPreset(type) {
    if (notes.length > 0 && !confirm('Заменить текущие ноты пресетом?')) {
        return;
    }
    
    const presets = {
        'scale': [
            {isChord: false, note: 60, noteText: 'C4 (До)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 62, noteText: 'D4 (Ре)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 64, noteText: 'E4 (Ми)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 65, noteText: 'F4 (Фа)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 67, noteText: 'G4 (Соль)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 69, noteText: 'A4 (Ля)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 71, noteText: 'B4 (Си)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 72, noteText: 'C5 (До)', duration: 192, durationText: '𝅗𝅥 Половинная (1/2)', velocity: 110}
        ],
        'chords': [
            {
                isChord: true,
                notes: [
                    {note: 60, noteText: 'C4 (До)', velocity: 100},
                    {note: 64, noteText: 'E4 (Ми)', velocity: 100},
                    {note: 67, noteText: 'G4 (Соль)', velocity: 100}
                ],
                duration: 192,
                durationText: '𝅗𝅥 Половинная (1/2)'
            },
            {
                isChord: true,
                notes: [
                    {note: 65, noteText: 'F4 (Фа)', velocity: 100},
                    {note: 69, noteText: 'A4 (Ля)', velocity: 100},
                    {note: 72, noteText: 'C5 (До)', velocity: 100}
                ],
                duration: 192,
                durationText: '𝅗𝅥 Половинная (1/2)'
            },
            {
                isChord: true,
                notes: [
                    {note: 67, noteText: 'G4 (Соль)', velocity: 100},
                    {note: 71, noteText: 'B4 (Си)', velocity: 100},
                    {note: 74, noteText: 'D5 (Ре)', velocity: 100}
                ],
                duration: 192,
                durationText: '𝅗𝅥 Половинная (1/2)'
            },
            {
                isChord: true,
                notes: [
                    {note: 60, noteText: 'C4 (До)', velocity: 110},
                    {note: 64, noteText: 'E4 (Ми)', velocity: 110},
                    {note: 67, noteText: 'G4 (Соль)', velocity: 110}
                ],
                duration: 384,
                durationText: '🎵 Целая (1)'
            }
        ],
        'melody': [
            {isChord: false, note: 60, noteText: 'C4 (До)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 90},
            {isChord: false, note: 64, noteText: 'E4 (Ми)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 95},
            {isChord: false, note: 67, noteText: 'G4 (Соль)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 72, noteText: 'C5 (До)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 105},
            {isChord: false, note: 67, noteText: 'G4 (Соль)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {isChord: false, note: 64, noteText: 'E4 (Ми)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 95},
            {isChord: false, note: 60, noteText: 'C4 (До)', duration: 192, durationText: '𝅗𝅥 Половинная (1/2)', velocity: 90}
        ],
        'piano': [
            {isChord: false, note: 72, noteText: 'C5 (До)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 100},
            {
                isChord: true,
                notes: [
                    {note: 48, noteText: 'C3 (До)', velocity: 70},
                    {note: 52, noteText: 'E3 (Ми)', velocity: 70},
                    {note: 55, noteText: 'G3 (Соль)', velocity: 70}
                ],
                duration: 96,
                durationText: '♩ Четвертная (1/4)'
            },
            {isChord: false, note: 76, noteText: 'E5 (Ми)', duration: 96, durationText: '♩ Четвертная (1/4)', velocity: 105},
            {
                isChord: true,
                notes: [
                    {note: 57, noteText: 'A3 (Ля)', velocity: 70},
                    {note: 60, noteText: 'C4 (До)', velocity: 70},
                    {note: 64, noteText: 'E4 (Ми)', velocity: 70}
                ],
                duration: 96,
                durationText: '♩ Четвертная (1/4)'
            },
            {
                isChord: true,
                notes: [
                    {note: 48, noteText: 'C3 (До)', velocity: 80},
                    {note: 60, noteText: 'C4 (До)', velocity: 90},
                    {note: 64, noteText: 'E4 (Ми)', velocity: 90},
                    {note: 67, noteText: 'G4 (Соль)', velocity: 90},
                    {note: 72, noteText: 'C5 (До)', velocity: 100}
                ],
                duration: 384,
                durationText: '🎵 Целая (1)'
            }
        ]
    };
    
    notes = presets[type] || [];
    showToast('✨ Пресет загружен');
    
    const presetsSection = document.getElementById('presetsSection');
    if (presetsSection) {
        presetsSection.style.background = '#d4edda';
        setTimeout(() => {
            presetsSection.style.background = '#fff3cd';
        }, 300);
    }
    
    updateNotesList();
    updateStats();
    saveToLocalStorage();
}

// ==================== ГЕНЕРАЦИЯ MIDI ====================

function toVariableLength(value) {
    if (value === 0) return [0x00];
    
    const bytes = [];
    bytes.push(value & 0x7F);
    
    value >>= 7;
    while (value > 0) {
        bytes.unshift((value & 0x7F) | 0x80);
        value >>= 7;
    }
    
    return bytes;
}

function generateMIDI() {
    if (notes.length === 0) {
        showToast('Добавьте хотя бы одну ноту!', true);
        return;
    }
    
    try {
        const header = [
            0x4d, 0x54, 0x68, 0x64,
            0x00, 0x00, 0x00, 0x06,
            0x00, 0x00,
            0x00, 0x01,
            0x00, 0x60
        ];
        
        const events = [];
        
        const microsecondsPerQuarter = Math.floor(60000000 / tempo);
        const tempoBytes = [
            (microsecondsPerQuarter >> 16) & 0xFF,
            (microsecondsPerQuarter >> 8) & 0xFF,
            microsecondsPerQuarter & 0xFF
        ];
        
        events.push(0x00, 0xFF, 0x51, 0x03, ...tempoBytes);
        
        notes.forEach((item) => {
            if (item.isChord) {
                // Включаем все ноты аккорда одновременно
                item.notes.forEach((noteData) => {
                    events.push(0x00, 0x90, noteData.note, noteData.velocity);
                });
                
                // Выключаем первую ноту с задержкой
                const deltaTime = toVariableLength(item.duration);
                events.push(...deltaTime, 0x80, item.notes[0].note, 0x00);
                
                // Выключаем остальные ноты без задержки
                for (let i = 1; i < item.notes.length; i++) {
                    events.push(0x00, 0x80, item.notes[i].note, 0x00);
                }
            } else {
                events.push(0x00, 0x90, item.note, item.velocity);
                
                const deltaTime = toVariableLength(item.duration);
                events.push(...deltaTime, 0x80, item.note, 0x00);
            }
        });
        
        events.push(0x00, 0xFF, 0x2F, 0x00);
        
        const trackLength = events.length;
        const track = [
            0x4d, 0x54, 0x72, 0x6b,
            (trackLength >> 24) & 0xFF,
            (trackLength >> 16) & 0xFF,
            (trackLength >> 8) & 0xFF,
            trackLength & 0xFF
        ];
        
        const midiData = new Uint8Array([...header, ...track, ...events]);
        
        const blob = new Blob([midiData], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `melody_${Date.now()}.mid`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('✅ MIDI файл успешно скачан!');
        
    } catch (error) {
        showToast('❌ Ошибка генерации: ' + error.message, true);
        console.error('Ошибка MIDI:', error);
    }
}

// ==================== АВТОСОХРАНЕНИЕ ====================

function saveToLocalStorage() {
    try {
        localStorage.setItem('midi_notes', JSON.stringify(notes));
        localStorage.setItem('midi_tempo', tempo);
        localStorage.setItem('midi_waveform', waveformType);
        localStorage.setItem('midi_loop', loopEnabled);
    } catch (e) {
        console.warn('Не удалось сохранить:', e);
    }
}

function loadFromLocalStorage() {
    try {
        const savedNotes = localStorage.getItem('midi_notes');
        const savedTempo = localStorage.getItem('midi_tempo');
        const savedWaveform = localStorage.getItem('midi_waveform');
        const savedLoop = localStorage.getItem('midi_loop');
        
        if (savedNotes) {
            notes = JSON.parse(savedNotes);
            updateNotesList();
            if (notes.length > 0) {
                showToast('💾 Проект восстановлен из автосохранения');
            }
        }
        
        if (savedTempo) {
            tempo = parseInt(savedTempo);
            const tempoSlider = document.getElementById('tempoSlider');
            if (tempoSlider) tempoSlider.value = tempo;
            updateTempo(tempo);
        }
        
        if (savedWaveform) {
            waveformType = savedWaveform;
            const waveformSelect = document.getElementById('waveform');
            if (waveformSelect) waveformSelect.value = waveformType;
        }
        
        if (savedLoop) {
            loopEnabled = savedLoop === 'true';
            const btn = document.getElementById('loopBtn');
            const icon = document.getElementById('loopIcon');
            if (icon) icon.textContent = loopEnabled ? '🔂' : '🔁';
            if (loopEnabled && btn) {
                btn.classList.add('loop-active');
            }
        }
    } catch (e) {
        console.warn('Не удалось загрузить:', e);
    }
}

// ==================== ГОРЯЧИЕ КЛАВИШИ ====================

document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
        if (e.key === 'Enter') {
            if (currentChord.length > 0) {
                addChord();
            } else {
                addNote();
            }
        }
        return;
    }
    
    if (e.key === ' ') {
        e.preventDefault();
        if (isPlaying) {
            stopMelody();
        } else if (notes.length > 0) {
            playMelody();
        }
    }
    
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        clearNotes();
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        reverseNotes();
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        toggleLoop();
    }
});

// ==================== ОЧИСТКА РЕСУРСОВ ПРИ ЗАКРЫТИИ ====================

window.addEventListener('beforeunload', () => {
    if (isPlaying) {
        stopMelody();
    }
    if (audioContext) {
        audioContext.close();
    }
});

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

window.addEventListener('DOMContentLoaded', () => {
    loadFromLocalStorage();
    updateStats();
    updateChordDisplay();
});

setInterval(() => {
    if (notes.length > 0) {
        saveToLocalStorage();
    }
}, 30000);