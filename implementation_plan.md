# 身體對話 團隊月曆 Web App

## 背景與目標

把現有 intelligence-mindmap 的殼改造為一個給 ~10 人團隊使用的共用活動月曆，讓大家可以瀏覽空間使用情況、認領活動、跨裝置跨平台無痛瀏覽，完全免費。

---

## 架構決策

```
events.json (GitHub repo)
    ↕ GitHub Contents API
index.html (SPA, 純前端)
    ├── 月曆 / 週曆視圖
    ├── 活動詳情 sidebar
    ├── 新增/編輯/刪除表單
    └── 認領功能（需登入）
    
GitHub Pages / Cloudflare Pages → 公開瀏覽
GitHub commit history → 版本管理（可回滾）
iCal feed → 同步 Google/Apple 日曆（選配）
```

**為什麼 GitHub JSON as DB？**
- 完全免費
- 每次寫入 = 一次 git commit = 天然版本歷史
- 不需要後端伺服器
- GitHub API 對小團隊 rate limit 完全夠用

---

## 身份識別 & 權限管理

使用 **GitHub PAT + 前端 Role Enforcement**：
- 每個成員各自設定 PAT（需要 `repo` scope）存 localStorage
- 前端用此 token 呼叫 GitHub API，commit author 就是本人 → **自動記錄操作者**
- 對 3C 不熟的成員：**引導用 Google 帳號登入 GitHub**（不難），再帶他們產生 PAT
- PAT 儲存於 localStorage，設定一次即可

**角色權限（儲存於 `config.json`）**：

| 功能 | Admin | Collaborator |
|---|---|---|
| 新增活動 | ✅ | ❌ |
| 編輯活動內容 | ✅ | ❌ |
| 刪除活動 | ✅ | ❌ |
| 認領/取消認領 | ✅ | ✅ |
| 編輯自己的認領記錄 | ✅ | ✅ |

> ❗ 前端強制，有 repo write 權限者技術上仍可繞過。對一般團隊成員絕對夠用。需硬邊界可後續加 serverless middleware。

> **認領記錄**：每次認領/取消認領 = 一次 commit，git log 就是完整操作記錄。

---

## 資料結構 `events.json`

```json
{
  "version": "1.0",
  "updated_at": "2026-09-05T08:00:00+08:00",
  "events": [
    {
      "id": "evt_1150902",
      "title": "【公益讀書會】Let Them 隨他們去",
      "type": "public",
      "category": "讀書會",
      "date": "2026-09-02",
      "start_time": "14:00",
      "end_time": "17:00",
      "location": "台中場",
      "host": "方珍",
      "needs_door": false,
      "registration_url": "https://bodytalk.tw/s/1150902",
      "assignee": null,
      "notes": "",
      "recurring": null
    }
  ]
}
```

**event.type 枚舉**：`public`（公益）| `course`（正式課程）| `study_group`（讀書會/自主）

**event.recurring**：`null` 或 `{ pattern: "weekly", day: 5 }`（用於週期性活動展開）

---

## UI 功能規劃

### 月曆視圖（主視圖）
- 月份切換（上月 / 下月）
- 每格顯示當天活動小卡（顏色區分類型）
- 點擊活動 → **畫面正中央模態展開，導曙被模糊處理**（backdrop blur）
- 顏色標示認領狀態（未認領/已認領），**已認領者顯示帳號小圖 + username**

### 活動詳情 Modal
- 畫面正中央浮層，背景模糊（CSS `backdrop-filter: blur`）
- 顯示所有欄位
- **認領按鈕**（點擊後寫入 assignee = 目前登入者）
- 取消認領按鈕
- 編輯 / 刪除按鈕（需登入）

### 新增/編輯表單（Modal 内）
- 欄位：標題、類型、日期、開始/結束時間、地點、主持人、報名連結、備注
- 送出後呼叫 GitHub API commit

### Header Toolbar 按鈕
- ✅ **搜尋框**（搜活動名稱）
- ✅ **Undo / Redo**（本地編輯操作）
- ✅ **視圖切換**：右側日曆切換 Day / Week / Month（左側永遠是純文字區）
- ✅ **分享**：觸發 `navigator.share()`（手機內建分享），fallback 複製連結
- ✅ **深淺色切換**
- ❌ ~~縮放/置中~~、~~一鍵展開~~、~~直角/曲線切換~~、~~下載 SVG/MD~~

### 左側純文字區
- 顯示本月活動清單純文字版
- 可供複製貼上到 LINE 群等

### 登入狀態列
- 右上角顯示目前登入者（GitHub username）
- 設定 PAT 入口

---

## 確認的技術決策

- **新建 repo**：`bodytalk-calendar`（不改動現有 mindmap repo）
- **CSS 框架**：TailwindCSS CDN（沿用現有慣例，免費）
- **D3**：用於月曆格線/時間軸渲染
- **身份識別**：GitHub PAT 存 localStorage

## 檔案結構

```
bodytalk-calendar/
├── index.html      ← layout、header、toolbar
├── script.js       ← 月曆渲染、GitHub API、認領邏輯
├── style.css       ← 自訂樣式（Tailwind 補不到的部分）
├── events.json     ← 資料 SSOT
└── README.md
```

---

## 九月份 Demo 資料

已從 `身體對話生活覺識場.md` 解析出以下活動（待轉換為 JSON）：

| 日期 | 活動 | 時間 |
|---|---|---|
| 9/2(三) | 公益讀書會 Let Them | 14:00-17:00 |
| 9/3(四) | 生活易經 | 10:00-12:00 |
| 9/5(六) | 從紅塵到心靈的解藥 | 14:00-17:00 |
| 9/6(日) | 意識對話與身體連結（複合場）| 13:30-19:30 |
| 9/7(一) | 奧修譲老子道德經 / 昆達里尼瑜伽 | 14:30-16:30 |
| 9/12(六) | 秋季耳穴保健 | 14:00-17:00 |
| 9/13(日) | 城市淨心 森林靜心（台北場）| 10:00-17:00 |
| 9/14(一) | 正念自我照顧 / 內觀流瑜伽 | 14:00-18:30 |
| 9/17(四) | 呼吸工作坊 / 昆達里尼基礎脊榄 | 10:30-17:00 |
| 9/18(五) | 心靈牌卡潛意識導引基礎班 | 10:00-18:00 |
| 9/19(六) | 站樁工作坊 | 10:00-12:00 |
| 9/20(日) | 城市淨心 一日工作坊（台中）| 10:00-18:30 |
| 9/21(一) | 一盞茶，遇見自己 | 14:00-17:00 |
| 9/27(日) | 城市淨心 一日工作坊（竹北）| 10:00-19:30 |
| 每週五 | 健康歡樂鼓 | 13:30-14:50 |
| 9/6起每週日 | 空靈鼓教學初階班 | 10:30-12:00 |
| 9/9起每週三 | 潛意識導引讀玩書會（台中）| 14:00-17:00 |

---

## 未來自動化擴充潛力

現在不做，但架構天然支援：

1. **GitHub Actions 外部系統同步**
   - 寫 Python script 定時從老闆系統抓資料 → 更新 `events.json` → auto commit
   - `external_id` 欄位已預留在 JSON schema，方便對接

2. **iCal 自動生成**
   - 每次 `events.json` 更新 → Action 自動產生 `calendar.ics`
   - 成員訂閱後 Google/Apple 日曆自動同步

3. **LINE/Slack 通知**
   - 有人認領活動後，Action 觸發 webhook 通知整個頻道

4. **CSV 批次匯入**
   - 前端加「匯入 CSV」功能，批次建立活動

> 現在 `events.json` schema 會預留 `external_id` 欄位，未來任何外部系統就可以直接對接。

---

## 開發順序

1. **[x]** 建立 `events.json`（九月份資料）
2. **[ ]** `config.json`（roles 設定）
3. **[ ]** `index.html` 骨架
4. **[ ]** `style.css` 設計系統
5. **[ ]** `script.js` 月曆渲染
6. **[ ]** 活動詳情 Modal
7. **[ ]** GitHub API 整合（讀寫）
8. **[ ]** 登入 / PAT 設定
9. **[ ]** 新增/編輯/刪除表單
10. **[ ]** 認領功能 + role 權限檢查
11. **[ ]** 左側純文字區
12. **[ ]** 分享功能（Web Share API）

---

## Open Questions

> [!IMPORTANT]
> GitHub repo 是公開還是私有？如果是公開 repo，events.json 讀取不需要 token，只有寫入需要。如果是私有，連讀取都需要 token。
> 建議：repo 設 public，資料透明；或建一個新的獨立 repo 給這個 app。

> [!NOTE]
> 認領後要不要發通知給其他成員？如果要，可以考慮 GitHub Actions 觸發 email 或 webhook，但需要一點設定。

