# GitHub統計情報生成スクリプト
# 注意：実行前に新しいGitHubトークンを設定してください！

Write-Host "📊 GitHub統計情報を生成します..." -ForegroundColor Cyan

# トークンが設定されているか確認
$token = Read-Host "GitHubの個人アクセストークンを入力してください（表示されません）" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
$tokenPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

if ($tokenPlain -eq "") {
    Write-Host "❌ トークンが入力されていません！" -ForegroundColor Red
    exit 1
}

# 環境変数を設定
$env:GH_TOKEN = $tokenPlain
$env:GITHUB_USERNAME = "onaka-yurusugi"

Write-Host "🚀 統計情報を取得中..." -ForegroundColor Green

# Node.jsスクリプトを実行
node scripts/generate-stats.js

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 統計情報の生成が完了しました！" -ForegroundColor Green

    # GitHubにプッシュするか確認
    $push = Read-Host "`nGitHubにプッシュしますか？ (y/n)"

    if ($push -eq "y" -or $push -eq "Y") {
        Write-Host "`n📤 GitHubにプッシュ中..." -ForegroundColor Yellow
        git add .
        git commit -m "Update GitHub stats [skip ci]"
        git push
        Write-Host "✅ プッシュが完了しました！" -ForegroundColor Green
    }
} else {
    Write-Host "❌ エラーが発生しました" -ForegroundColor Red
}

# 環境変数をクリア
$env:GH_TOKEN = ""
$env:GITHUB_USERNAME = ""
