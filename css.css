* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: 'Segoe UI', Arial, sans-serif;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0b0e14;
  color: #eef2f7;
}

.hidden {
  display: none !important;
}

#menu {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 30px 0;
  background:
    radial-gradient(circle at 30% 20%, rgba(80, 220, 255, 0.08), transparent 60%),
    radial-gradient(circle at 70% 80%, rgba(255, 90, 180, 0.08), transparent 60%),
    #0b0e14;
  z-index: 50;
}

.menu-box {
  width: 440px;
  max-width: 92vw;
  background: rgba(20, 24, 34, 0.85);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  padding: 32px 30px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02) inset;
  backdrop-filter: blur(6px);
  text-align: center;
}

.title {
  font-size: 34px;
  font-weight: 800;
  letter-spacing: 2px;
  background: linear-gradient(90deg, #4fd6ff, #7cf29a);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.title span {
  background: linear-gradient(90deg, #ff6bd5, #ffd166);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.subtitle {
  margin-top: 6px;
  color: #9aa5b5;
  font-size: 13px;
  margin-bottom: 22px;
}

#nameInput {
  width: 100%;
  padding: 12px 14px;
  font-size: 15px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
  color: #fff;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

#nameInput:focus {
  border-color: #4fd6ff;
  box-shadow: 0 0 0 3px rgba(79, 214, 255, 0.15);
}

.mode-select {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 18px 0 20px;
}

.mode-btn {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
  color: #cfd6e2;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
}

.mode-btn.active {
  border-color: #4fd6ff;
  background: rgba(79, 214, 255, 0.12);
  color: #fff;
  box-shadow: 0 0 0 2px rgba(79,214,255,0.15);
}

.mode-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.soon {
  display: inline-block;
  margin-left: 8px;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(255,209,102,0.15);
  color: #ffd166;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.play-btn {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(90deg, #4fd6ff, #7cf29a);
  color: #06121a;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 1px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 8px 24px rgba(79, 214, 255, 0.25);
}

.play-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(79, 214, 255, 0.35);
}

.play-btn:active {
  transform: translateY(0);
}

.difficulty-select {
  margin-bottom: 20px;
  text-align: left;
}

.diff-label {
  font-size: 11px;
  color: #8a95a5;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.diff-btns {
  display: flex;
  gap: 8px;
}

.diff-btn, .quality-btn {
  flex: 1;
  padding: 10px 6px;
  border-radius: 9px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
  color: #cfd6e2;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}

.diff-btn[data-difficulty="easy"].active {
  border-color: #7cf29a;
  background: rgba(124, 242, 154, 0.14);
  color: #fff;
  box-shadow: 0 0 0 2px rgba(124,242,154,0.18);
}

.diff-btn[data-difficulty="medium"].active {
  border-color: #ffd166;
  background: rgba(255, 209, 102, 0.14);
  color: #fff;
  box-shadow: 0 0 0 2px rgba(255,209,102,0.18);
}

.diff-btn[data-difficulty="hard"].active {
  border-color: #ff6b6b;
  background: rgba(255, 107, 107, 0.14);
  color: #fff;
  box-shadow: 0 0 0 2px rgba(255,107,107,0.18);
}

.quality-btn.active {
  border-color: #b19dff;
  background: rgba(177, 157, 255, 0.14);
  color: #fff;
  box-shadow: 0 0 0 2px rgba(177,157,255,0.18);
}

.stats-row {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.stats-box {
  flex: 1;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 12px 14px;
  text-align: left;
}

.stats-box h3 {
  font-size: 11px;
  color: #8a95a5;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.stats-line {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #dbe2ee;
  margin-bottom: 4px;
}

.stats-line strong {
  color: #fff;
  font-weight: 700;
}

.menu-leaderboard {
  margin-top: 20px;
  text-align: left;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
  padding: 14px 16px;
}

.menu-leaderboard h3 {
  font-size: 13px;
  color: #9aa5b5;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}

.menu-leaderboard ol {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
}

.menu-leaderboard li {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #dbe2ee;
  padding: 4px 2px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.lb-empty {
  color: #6b7686 !important;
  justify-content: center !important;
}

.hint {
  margin-top: 16px;
  font-size: 11px;
  color: #6b7686;
}

#gameUI {
  position: fixed;
  inset: 0;
  z-index: 10;
}

#gameCanvas {
  display: block;
  width: 100%;
  height: 100%;
  background: #12161f;
}

#hud {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 20;
  pointer-events: none;
}

.hud-panel {
  pointer-events: auto;
}

.leaderboard-panel {
  min-width: 240px;
  max-width: 270px;
  text-align: right;
}

.leaderboard-panel h3 {
  font-size: 18px;
  color: #fff;
  margin-bottom: 8px;
  font-weight: 700;
}

.leaderboard-panel ol {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.leaderboard-panel li {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 13px;
  color: #b7c0cf;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}

.leaderboard-panel li .rank {
  color: #7c8798;
  width: 20px;
  text-align: left;
}

.leaderboard-panel li .lswatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 4px rgba(0,0,0,0.6);
}

.leaderboard-panel li .lname {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leaderboard-panel li.me {
  color: #7cf29a;
  font-weight: 700;
}

#rankReadout {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 20;
  color: rgba(255,255,255,0.8);
  font-size: 14px;
  line-height: 1.7;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
}

#rankReadout strong {
  color: #fff;
  font-weight: 700;
}

#minimapWrap {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 130px;
  height: 130px;
  z-index: 20;
}

#minimap {
  width: 100%;
  height: 100%;
  display: block;
}

#serverLabel {
  position: absolute;
  bottom: -20px;
  right: 0;
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  white-space: nowrap;
}

#topLeaderboardOverlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6,8,12,0.8);
  backdrop-filter: blur(3px);
}

.top-lb-box {
  width: 420px;
  max-width: 90vw;
  background: rgba(20,24,34,0.95);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  padding: 28px;
  text-align: left;
}

.top-lb-box h2 {
  font-size: 18px;
  color: #fff;
  margin-bottom: 16px;
  text-align: center;
}

.top-lb-box ol {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow-y: auto;
  margin-bottom: 20px;
}

.top-lb-box li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 14px;
  color: #dbe2ee;
  padding: 6px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.top-lb-box li .rank {
  color: #7c8798;
  width: 26px;
}

.top-lb-box li .lname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

body.low-quality #menu {
  background: #0b0e14;
}

body.low-quality .menu-box {
  backdrop-filter: none;
  box-shadow: none;
}

.__fatalErrorBox {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 99999;
  background: #4a0d0d;
  color: #ffdada;
  font-family: monospace;
  font-size: 13px;
  padding: 12px 16px;
  border-bottom: 2px solid #ff6b6b;
  white-space: pre-wrap;
  max-height: 40vh;
  overflow: auto;
}
