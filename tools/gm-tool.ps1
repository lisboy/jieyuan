# 拾缘 · 本地管理台（GM）
# 直接在存档 JSON 上改数值：充值、补材料、拉等级、解关卡、清保底。
# 游戏运行时内存里的存档会盖掉这里改的东西，所以要求先退出游戏。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$savePath = Join-Path $env:USERPROFILE "AppData\LocalLow\DefaultCompany\拾缘\shiyuan_save.json"
$configPath = Join-Path $PSScriptRoot "..\data\config.json"

function Load-Save {
    if (-not (Test-Path $savePath)) { throw "找不到存档：$savePath（先启动一次游戏）" }
    $raw = [System.IO.File]::ReadAllText($savePath, [System.Text.Encoding]::UTF8)
    return ($raw | ConvertFrom-Json)
}

function Save-Save($obj) {
    $json = $obj | ConvertTo-Json -Depth 24
    $bak = "$savePath.bak"
    Copy-Item $savePath $bak -Force
    [System.IO.File]::WriteAllText($savePath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-GameRunning {
    return [bool](Get-Process -Name "Shiyuan" -ErrorAction SilentlyContinue)
}

$config = $null
if (Test-Path $configPath) { $config = ([System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json) }

$caps = @{ coin = 99999999; jade = 999999; stamina = 120; essence = 999999 }
if ($config.meta.economy.currencies) {
    foreach ($k in @("coin", "jade", "stamina", "essence")) {
        $c = $config.meta.economy.currencies.$k
        if ($c -and $c.cap) { $caps[$k] = [int]$c.cap }
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "拾缘 · 管理台"
$form.Size = New-Object System.Drawing.Size(720, 760)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(24, 22, 28)
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)

function New-Label($text, $x, $y, $w, $h, $size, $rgb) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.Location = New-Object System.Drawing.Point($x, $y)
    $l.Size = New-Object System.Drawing.Size($w, $h)
    $l.ForeColor = [System.Drawing.Color]::FromArgb($rgb[0], $rgb[1], $rgb[2])
    $l.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", $size)
    return $l
}

function New-Button($text, $x, $y, $w, $h, $script) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text
    $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, $h)
    $b.FlatStyle = "Flat"
    $b.BackColor = [System.Drawing.Color]::FromArgb(52, 44, 62)
    $b.ForeColor = [System.Drawing.Color]::FromArgb(240, 232, 214)
    $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(120, 106, 82)
    $b.Add_Click($script)
    return $b
}

$statusBox = New-Object System.Windows.Forms.TextBox
$statusBox.Location = New-Object System.Drawing.Point(20, 620)
$statusBox.Size = New-Object System.Drawing.Size(665, 90)
$statusBox.Multiline = $true
$statusBox.ReadOnly = $true
$statusBox.ScrollBars = "Vertical"
$statusBox.BackColor = [System.Drawing.Color]::FromArgb(16, 15, 19)
$statusBox.ForeColor = [System.Drawing.Color]::FromArgb(190, 220, 190)
$statusBox.Font = New-Object System.Drawing.Font("Consolas", 9)

function Say($msg) {
    $statusBox.AppendText(("[{0}] {1}`r`n" -f (Get-Date -Format "HH:mm:ss"), $msg))
}

function Invoke-Edit([scriptblock]$body, [string]$what) {
    if (Get-GameRunning) {
        [System.Windows.Forms.MessageBox]::Show("游戏正在运行，内存里的存档会覆盖改动。`n请先退出《拾缘》再来。", "先关游戏", "OK", "Warning") | Out-Null
        Say "跳过：游戏还在运行"
        return
    }
    try {
        $save = Load-Save
        & $body $save
        $save.updatedAt = [int64](([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds())
        Save-Save $save
        Say "$what 完成"
        Refresh-Status
    }
    catch {
        Say "失败：$($_.Exception.Message)"
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "出错了", "OK", "Error") | Out-Null
    }
}

function Refresh-Status {
    try {
        $s = Load-Save
        $t = $s.team.Count
        $c = ($s.cards.PSObject.Properties | Measure-Object).Count
        $cleared = ($s.stages.PSObject.Properties | Where-Object { $_.Value.stars -gt 0 } | Measure-Object).Count
        $statusBox.Text = ""
        Say "存档：$savePath"
        Say ("铜钱 {0}　缘玉 {1}　心神 {2}　精魄 {3}" -f $s.wallet.coin, $s.wallet.jade, $s.wallet.stamina, $s.wallet.essence)
        Say ("角色 {0} 张　编队 {1} 人　已通关卡 {2}" -f $c, $t, $cleared)
    }
    catch { Say "读存档失败：$($_.Exception.Message)" }
}

# ---------- 头部 ----------
$title = New-Label "拾 缘 · 管 理 台" 20 16 500 38 18 @(232, 214, 170)
$form.Controls.Add($title)
$hint = New-Label "改的是本机存档，改完再启动游戏。每次写入都会留一份 .bak。" 20 56 660 24 9 @(150, 145, 135)
$form.Controls.Add($hint)

# ---------- 充值 ----------
$form.Controls.Add((New-Label "充值" 20 92 200 24 11 @(230, 200, 140)))
$amount = New-Object System.Windows.Forms.TextBox
$amount.Location = New-Object System.Drawing.Point(20, 120)
$amount.Size = New-Object System.Drawing.Size(140, 28)
$amount.Text = "10000"
$form.Controls.Add($amount)
$form.Controls.Add((New-Button "加缘玉" 172 118 120 32 { Invoke-Edit { param($s) $v = [int]$amount.Text; $s.wallet.jade = [Math]::Min($caps.jade, [int]$s.wallet.jade + $v) } "缘玉 +$($amount.Text)" }))
$form.Controls.Add((New-Button "加铜钱×10" 300 118 130 32 { Invoke-Edit { param($s) $v = [int]$amount.Text * 10; $s.wallet.coin = [Math]::Min($caps.coin, [int]$s.wallet.coin + $v) } "铜钱充值" }))
$form.Controls.Add((New-Button "加精魄" 438 118 110 32 { Invoke-Edit { param($s) $v = [int]$amount.Text; $s.wallet.essence = [Math]::Min($caps.essence, [int]$s.wallet.essence + $v) } "精魄充值" }))
$form.Controls.Add((New-Button "心神回满" 556 118 120 32 { Invoke-Edit { param($s) $s.wallet.stamina = $caps.stamina; $s.staminaClock = [int64](([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()) } "心神回满" }))

$form.Controls.Add((New-Button "缘玉拉满" 20 160 130 32 { Invoke-Edit { param($s) $s.wallet.jade = $caps.jade } "缘玉拉满" }))
$form.Controls.Add((New-Button "铜钱拉满" 158 160 130 32 { Invoke-Edit { param($s) $s.wallet.coin = $caps.coin } "铜钱拉满" }))
$form.Controls.Add((New-Button "残卷各 +999" 296 160 150 32 { Invoke-Edit { param($s) foreach ($k in @("ur", "ssr", "sr", "r", "n")) { $s.wallet.shard | Add-Member -NotePropertyName $k -NotePropertyValue 999 -Force } } "残卷补齐" }))
$form.Controls.Add((New-Button "技能书各 +99" 454 160 150 32 { Invoke-Edit { param($s) foreach ($k in @("purple", "gold", "red")) { $s.wallet.tome | Add-Member -NotePropertyName $k -NotePropertyValue 99 -Force } } "技能书补齐" }))
$form.Controls.Add((New-Button "材料各 +999" 20 198 150 32 { Invoke-Edit { param($s) foreach ($k in @("page", "note", "scroll", "pill")) { $s.wallet.mat | Add-Member -NotePropertyName $k -NotePropertyValue 999 -Force } } "材料补齐" }))
$form.Controls.Add((New-Button "清空保底" 178 198 150 32 { Invoke-Edit { param($s) foreach ($p in $s.pity.PSObject.Properties) { $p.Value.sinceRed = 0; $p.Value.sincePurple = 0; $p.Value.pulls = 0 } } "保底清零（更容易出红）" }))
$form.Controls.Add((New-Button "解锁全关卡" 336 198 150 32 { Invoke-Edit { param($s) foreach ($st in $config.meta.stages) { $s.stages | Add-Member -NotePropertyName $st.id -NotePropertyValue ([pscustomobject]@{ stars = 3; clears = 1 }) -Force } } "全部关卡标三星" }))

# ---------- 角色 ----------
$form.Controls.Add((New-Label "角色" 20 246 200 24 11 @(230, 200, 140)))
$form.Controls.Add((New-Button "全体 +10 级" 20 274 150 32 { Invoke-Edit { param($s) foreach ($p in $s.cards.PSObject.Properties) { $p.Value.level = [Math]::Min(80, [int]$p.Value.level + 10); $p.Value.exp = 0 } } "全体 +10 级" }))
$form.Controls.Add((New-Button "全体满级" 178 274 150 32 { Invoke-Edit { param($s) foreach ($p in $s.cards.PSObject.Properties) { $p.Value.level = 80; $p.Value.exp = 0 } } "全体 Lv.80" }))
$form.Controls.Add((New-Button "全体 ★6" 336 274 150 32 { Invoke-Edit { param($s) foreach ($p in $s.cards.PSObject.Properties) { $p.Value.star = 6 } } "全体六星" }))
$form.Controls.Add((New-Button "全体满突破" 494 274 150 32 { Invoke-Edit { param($s) foreach ($p in $s.cards.PSObject.Properties) { $p.Value.bt = 5 } } "全体满突破" }))
$form.Controls.Add((New-Button "技能全 5 级" 20 312 150 32 { Invoke-Edit { param($s) foreach ($p in $s.cards.PSObject.Properties) { $keys = @($p.Value.skills.PSObject.Properties.Name); foreach ($k in $keys) { $p.Value.skills.$k = 5 } } } "技能全 5 级" }))

# ---------- 其它 ----------
$form.Controls.Add((New-Label "杂项" 20 360 200 24 11 @(230, 200, 140)))
$form.Controls.Add((New-Button "备份存档" 20 388 150 32 { try { Copy-Item $savePath "$savePath.manual" -Force; Say "已备份到 shiyuan_save.json.manual" } catch { Say "备份失败：$($_.Exception.Message)" } }))
$form.Controls.Add((New-Button "还原备份" 178 388 150 32 {
            try {
                if (Get-GameRunning) { Say "先关游戏"; return }
                Copy-Item "$savePath.bak" $savePath -Force
                Say "已用 .bak 还原"
                Refresh-Status
            }
            catch { Say "还原失败：$($_.Exception.Message)" }
        }))
$form.Controls.Add((New-Button "打开存档目录" 336 388 150 32 { Start-Process explorer.exe "/select,`"$savePath`"" }))
$form.Controls.Add((New-Button "刷新" 494 388 100 32 { Refresh-Status }))
$form.Controls.Add((New-Button "启动游戏" 20 428 150 36 {
            $exe = Join-Path $PSScriptRoot "..\unity\Builds\Windows\Shiyuan.exe"
            if (Test-Path $exe) { Start-Process $exe; Say "已启动" } else { Say "没找到打包产物：$exe" }
        }))
$form.Controls.Add((New-Button "启动并进战斗" 178 428 190 36 {
            $exe = Join-Path $PSScriptRoot "..\unity\Builds\Windows\Shiyuan.exe"
            if (Test-Path $exe) { Start-Process $exe -ArgumentList "-uitour"; Say "已启动巡游模式（截 21 张图）" } else { Say "没找到打包产物" }
        }))

$form.Controls.Add($statusBox)
Refresh-Status
[void]$form.ShowDialog()
