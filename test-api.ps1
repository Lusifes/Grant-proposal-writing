$ErrorActionPreference = 'Stop'
$base = 'http://localhost:4321/api'
function PostJson($url, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
}
function PatchJson($url, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8
  Invoke-RestMethod -Uri $url -Method Patch -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
}
function GetJson($url) { Invoke-RestMethod -Uri $url -Method Get }

Write-Output '== 1. Create project =='
$proj = PostJson "$base/projects" @{
  name = 'ML prediction of mechanical properties of high-entropy alloys'
  direction = 'Computational materials / HEA / ML'
  grant_type = '国家自然科学基金面上项目'
  year = '2026'
  foundation = 'Team has DFT and CALPHAD modeling experience.'
  requirements = 'Max 30 pages; emphasize interpretability.'
  ai_mode = 'draft_allowed'
}
$pid0 = $proj.id
Write-Output "ProjectID: $pid0  Template: $($proj.template_id)  Stage1: $($proj.stage1)"

Write-Output '== 2. AI error path without API key =='
try { $null = PostJson "$base/projects/$pid0/stage1/report" @{ topic = 'x' }; Write-Output '!!! no error (BAD)' }
catch { Write-Output "OK error: $($_.ErrorDetails.Message)" }

Write-Output '== 3. Real literature search (OpenAlex/Crossref) =='
$r = PostJson "$base/projects/$pid0/stage1/run" @{
  topic = 'machine learning prediction mechanical properties high entropy alloys'
  fromYear = '2019'; toYear = '2026'; focus = 'composition process property'; targetCount = 20
}
Write-Output "Strategy source: $($r.strategySource) | Added: $($r.added) | Total: $($r.total)"
Write-Output "Main query: $($r.strategy.mainQuery)"
$lits = GetJson "$base/projects/$pid0/literatures"
if ($lits.Count -gt 0) {
  $l0 = $lits[0]
  Write-Output "Sample lit: $($l0.title) | Year: $($l0.year) | DOI: $($l0.doi) | Status: $($l0.status) | Source: $($l0.source)"
  Write-Output "Abstract length: $($l0.abstract.Length)"
} else { Write-Output '!!! no literature found' }

Write-Output '== 4. Select core papers and complete stage 1 =='
$sel = @($lits | Where-Object { $_.abstract } | Select-Object -First 3)
foreach ($l in $sel) { $null = PatchJson "$base/literatures/$($l.id)" @{ selected = 1 } }
$p2 = PostJson "$base/projects/$pid0/stage1/complete" @{}
Write-Output "Stage1: $($p2.stage1) | Stage2: $($p2.stage2)"

Write-Output '== 5. Manual edit of literature note =='
$null = PatchJson "$base/literatures/$($sel[0].id)" @{ note = 'human-verified with extra note' }
$lits2 = GetJson "$base/projects/$pid0/literatures"
Write-Output "Note saved: $(($lits2 | Where-Object { $_.id -eq $sel[0].id }).note)"

Write-Output '== 6. Stage3 structure =='
$s3 = GetJson "$base/projects/$pid0/stage3"
Write-Output "Template: $($s3.template.name) | Chapters: $($s3.template.structure.Count) | Selected lits: $($s3.literatures.Count)"

Write-Output '== 7. Chapter save / version / restore =='
$ch = $s3.template.structure[0].id
$null = PostJson "$base/projects/$pid0/stage3/save" @{ chapterId = $ch; content = "# Abstract`n`nThis project studies ML methods for HEA properties.`n`n[1] (Zhang, 2023)" }
$null = PostJson "$base/projects/$pid0/stage3/version" @{ chapterId = $ch }
$null = PostJson "$base/projects/$pid0/stage3/save" @{ chapterId = $ch; content = "# Abstract (revised)`n`nRevised content.`n`n[1] (Zhang, 2023)" }
$arts = GetJson "$base/projects/$pid0/artifacts"
$chArt = $arts | Where-Object { $_.kind -eq 'chapter' } | Select-Object -First 1
Write-Output "Chapter version: $($chArt.version) (expect 2)"
$versions = GetJson "$base/artifacts/$($chArt.id)/versions"
Write-Output "Version snapshots: $($versions.versions.Count)"

Write-Output '== 8. Todos =='
$null = PostJson "$base/projects/$pid0/todos" @{ text = 'todo: verify budget'; stage = 3 }
$todos = GetJson "$base/projects/$pid0/todos"
Write-Output "Todos: $($todos.Count) | Pending: $(@($todos | Where-Object { $_.status -eq 'pending' }).Count)"

Write-Output '== 9. Export =='
$md = (Invoke-WebRequest -UseBasicParsing -Uri "$base/projects/$pid0/export?format=md").Content
Write-Output "Markdown length: $($md.Length) | has refs section: $($md.Contains('References') -or $md.Contains('参考文献'))"
$docxPath = Join-Path $env:TEMP 'rgs-test.docx'
Invoke-WebRequest -UseBasicParsing -Uri "$base/projects/$pid0/export?format=docx" -OutFile $docxPath
$fi = Get-Item $docxPath
$bytes = [System.IO.File]::ReadAllBytes($docxPath)[0..1]
$sig = ($bytes | ForEach-Object { $_.ToString('X2') }) -join ''
Write-Output "DOCX bytes: $($fi.Length) | PK signature: $sig"
$refs = (Invoke-WebRequest -UseBasicParsing -Uri "$base/projects/$pid0/export?format=refs").Content
Write-Output "Refs length: $($refs.Length)"
Invoke-WebRequest -UseBasicParsing -Uri "$base/projects/$pid0/export?format=refs&refFormat=csv" -OutFile (Join-Path $env:TEMP 'rgs-refs.csv')
Write-Output "CSV exported: $((Get-Item (Join-Path $env:TEMP 'rgs-refs.csv')).Length) bytes"

Write-Output '== 10. Project stats (dashboard data source) =='
$detail = GetJson "$base/projects/$pid0"
Write-Output "Verified lits: $($detail.stats.verified) | Questions: $($detail.stats.questions) | Todos pending: $($detail.stats.todosPending) | Recent artifacts: $($detail.recent.Count)"

Write-Output "TEST_PID=$pid0"
