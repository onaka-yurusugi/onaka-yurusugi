const { Octokit } = require("@octokit/rest");
const fs = require('fs').promises;
const path = require('path');

const octokit = new Octokit({
    auth: process.env.GH_TOKEN,
});

const username = process.env.GITHUB_USERNAME || 'onaka-yurusugi';

async function getDetailedStats() {
    try {
        console.log('📊 統計情報を取得中...');

        // ユーザー情報を取得
        const { data: user } = await octokit.users.getAuthenticated();

        // すべてのリポジトリを取得（プライベート含む）
        const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
            visibility: 'all',
            affiliation: 'owner',
            per_page: 100,
            sort: 'updated'
        });

        console.log(`📁 ${repos.length}個のリポジトリを発見！`);

        // 統計を初期化
        let stats = {
            totalRepos: repos.length,
            publicRepos: 0,
            privateRepos: 0,
            totalStars: 0,
            totalForks: 0,
            totalCommits: 0,
            totalIssues: 0,
            totalPRs: 0,
            languages: {},
            recentActivity: [],
            topRepos: [],
            yearlyCommits: 0,
            totalContributions: 0,
            followers: user.followers,
            following: user.following,
            totalCodeAdditions: 0,
            totalCodeDeletions: 0,
            commitsByDay: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 },
            commitsByHour: {},
            recentCommits: []
        };

        // 時間別コミット数を初期化
        for (let i = 0; i < 24; i++) {
            stats.commitsByHour[i] = 0;
        }

        // 現在の日付と1年前の日付を計算
        const now = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1);

        // 各リポジトリの統計を集計
        for (const repo of repos) {
            if (repo.private) {
                stats.privateRepos++;
            } else {
                stats.publicRepos++;
            }

            stats.totalStars += repo.stargazers_count;
            stats.totalForks += repo.forks_count;

            // 言語情報を取得
            try {
                const { data: languages } = await octokit.repos.listLanguages({
                    owner: repo.owner.login,
                    repo: repo.name
                });

                for (const [lang, bytes] of Object.entries(languages)) {
                    stats.languages[lang] = (stats.languages[lang] || 0) + bytes;
                }
            } catch (e) {
                console.log(`⚠️ ${repo.name}の言語情報取得に失敗`);
            }

            // コミット情報を取得（最新100件 + 統計情報）
            try {
                const { data: commits } = await octokit.repos.listCommits({
                    owner: repo.owner.login,
                    repo: repo.name,
                    author: username,
                    per_page: 100,
                    since: oneYearAgo.toISOString()
                });

                stats.totalCommits += commits.length;
                stats.yearlyCommits += commits.length;

                // 最近のコミットを保存
                if (commits.length > 0 && stats.recentCommits.length < 10) {
                    commits.slice(0, 5).forEach(commit => {
                        stats.recentCommits.push({
                            repo: repo.name,
                            message: commit.commit.message,
                            date: commit.commit.author.date,
                            sha: commit.sha
                        });
                    });
                }

                // コミットの曜日と時間を集計
                commits.forEach(commit => {
                    const date = new Date(commit.commit.author.date);
                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    const day = dayNames[date.getDay()];
                    const hour = date.getHours();

                    stats.commitsByDay[day]++;
                    stats.commitsByHour[hour]++;
                });

                // コミットの統計情報を取得（追加/削除行数）
                for (const commit of commits.slice(0, 10)) { // 最新10件のみ
                    try {
                        const { data: commitDetail } = await octokit.repos.getCommit({
                            owner: repo.owner.login,
                            repo: repo.name,
                            ref: commit.sha
                        });
                        stats.totalCodeAdditions += commitDetail.stats.additions;
                        stats.totalCodeDeletions += commitDetail.stats.deletions;
                    } catch (e) {
                        // エラーは無視
                    }
                }
            } catch (e) {
                console.log(`⚠️ ${repo.name}のコミット情報取得に失敗`);
            }

            // イシューとPRの数を取得
            stats.totalIssues += repo.open_issues_count;

            // PRの数を取得
            try {
                const { data: prs } = await octokit.pulls.list({
                    owner: repo.owner.login,
                    repo: repo.name,
                    state: 'all',
                    per_page: 100
                });
                stats.totalPRs += prs.filter(pr => pr.user.login === username).length;
            } catch (e) {
                // エラーは無視
            }
        }

        // 総コントリビューション数を計算
        stats.totalContributions = stats.totalCommits + stats.totalPRs + stats.totalIssues;

        // 言語統計をパーセンテージに変換
        const totalBytes = Object.values(stats.languages).reduce((a, b) => a + b, 0);
        const languageStats = Object.entries(stats.languages)
            .map(([lang, bytes]) => ({
                name: lang,
                percentage: ((bytes / totalBytes) * 100).toFixed(2),
                bytes: bytes,
                color: getLanguageColor(lang)
            }))
            .sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage))
            .slice(0, 10);

        // トップリポジトリを選出
        stats.topRepos = repos
            .filter(repo => !repo.fork)
            .sort((a, b) => (b.stargazers_count + b.forks_count * 2 + (b.watchers_count || 0)) -
                (a.stargazers_count + a.forks_count * 2 + (a.watchers_count || 0)))
            .slice(0, 6)
            .map(repo => ({
                name: repo.name,
                description: repo.description,
                stars: repo.stargazers_count,
                forks: repo.forks_count,
                language: repo.language,
                url: repo.html_url,
                topics: repo.topics
            }));

        // 最もアクティブな曜日と時間を特定
        const mostActiveDay = Object.entries(stats.commitsByDay)
            .sort(([, a], [, b]) => b - a)[0];
        const mostActiveHour = Object.entries(stats.commitsByHour)
            .sort(([, a], [, b]) => b - a)[0];

        stats.mostActiveDay = mostActiveDay[0];
        stats.mostActiveHour = `${mostActiveHour[0]}:00`;

        // 最近のコミットをソート
        stats.recentCommits.sort((a, b) => new Date(b.date) - new Date(a.date));

        return { ...stats, languageStats, user };

    } catch (error) {
        console.error('❌ エラーが発生しました:', error.message);
        throw error;
    }
}

// 言語の色を取得
function getLanguageColor(lang) {
    const colors = {
        JavaScript: '#f1e05a',
        Python: '#3572A5',
        'C++': '#f34b7d',
        Java: '#b07219',
        TypeScript: '#2b7489',
        HTML: '#e34c26',
        CSS: '#563d7c',
        Ruby: '#701516',
        Go: '#00ADD8',
        Rust: '#dea584',
        PHP: '#4F5D95',
        'C#': '#178600',
        Swift: '#ffac45',
        Kotlin: '#F18E33',
        Dart: '#00B4AB',
        Vue: '#4fc08d',
        React: '#61dafb',
        SCSS: '#c6538c',
        'Jupyter Notebook': '#DA5B0B',
        Shell: '#89e051',
        PowerShell: '#012456',
        Dockerfile: '#384d54',
        Makefile: '#427819',
        PLpgSQL: '#336790',
        Roff: '#ecdebe'
    };
    return colors[lang] || '#586069';
}

// アクティビティヒートマップ用のSVGを生成
function generateActivityGraph(commitsByHour) {
    const maxCommits = Math.max(...Object.values(commitsByHour));
    const hours = Object.keys(commitsByHour).map(h => parseInt(h));

    let svg = '<svg width="600" height="150" xmlns="http://www.w3.org/2000/svg">';
    svg += '<rect width="600" height="150" fill="#0d1117" rx="5"/>';

    hours.forEach(hour => {
        const commits = commitsByHour[hour];
        const height = maxCommits > 0 ? (commits / maxCommits) * 120 : 0;
        const x = (hour / 24) * 580 + 10;
        const y = 140 - height;
        const color = commits > 0 ? `hsl(${120 - (commits / maxCommits) * 120}, 70%, 50%)` : '#30363d';

        svg += `<rect x="${x}" y="${y}" width="20" height="${height}" fill="${color}" rx="2"/>`;
        if (hour % 6 === 0) {
            svg += `<text x="${x + 10}" y="145" fill="#8b949e" text-anchor="middle" font-size="10">${hour}</text>`;
        }
    });

    svg += '</svg>';
    return svg;
}

// README.mdを更新
async function updateReadme(stats) {
    const readmePath = path.join(process.cwd(), 'README.md');
    let readme = await fs.readFile(readmePath, 'utf8');

    // base64エンコード関数
    const toBase64 = (str) => Buffer.from(str).toString('base64');

    // アクティビティグラフのSVG
    const activitySvg = generateActivityGraph(stats.commitsByHour);
    const activityDataUrl = `data:image/svg+xml;base64,${toBase64(activitySvg)}`;

    // 統計セクションを生成
    const statsSection = `
<!-- STATS:START -->
# Hi there! 👋 I'm ${stats.user.name || username} (@${username})

<div align="center">
    <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&pause=1000&color=36BCF7&center=true&vCenter=true&width=600&lines=Developer+from+Kagoshima;妹シミュレーション開発者;Machine+Learning+%26+Web+Scraping;Always+experimenting+with+new+ideas!" alt="Typing SVG" />
</div>

<div align="center">
  <a href="https://github.com/${username}">
    <img src="https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" />
  </a>
  <a href="https://github.com/${username}?tab=followers">
    <img src="https://img.shields.io/github/followers/${username}?style=for-the-badge&logo=github&label=Followers&color=blue" alt="Followers" />
  </a>
  <img src="https://komarev.com/ghpvc/?username=${username}&style=for-the-badge&color=brightgreen" alt="Profile Views" />
</div>

---

## 🚀 About Me

<img align="right" alt="Coding" width="400" src="https://user-images.githubusercontent.com/74038190/229223263-cf2e4b07-2615-4f87-9c38-e37600f8381a.gif">

- 🔭 現在 **${stats.topRepos[0]?.name || 'various projects'}** に取り組んでいます
- 🌱 Nextjsを学習中
- ⚡ Fun fact: **${stats.mostActiveHour}が最も生産的な時間です！**
- 📊 **${stats.yearlyCommits}** commits in the last year
- 🏆 **${stats.totalContributions}** total contributions

<br clear="both">

---

## 📊 GitHub Analytics

<div align="center">
  <img src="https://github-readme-stats.vercel.app/api?username=${username}&show_icons=true&theme=tokyonight&hide_border=true&count_private=true&include_all_commits=true" alt="GitHub Stats" height="180" />
  <img src="https://github-readme-streak-stats.herokuapp.com/?user=${username}&theme=tokyonight&hide_border=true" alt="GitHub Streak" height="180" />
</div>

<div align="center">
  <img src="https://github-readme-stats.vercel.app/api/top-langs/?username=${username}&layout=donut&theme=tokyonight&hide_border=true&langs_count=10" alt="Top Languages" />
</div>

---

## 🛠️ Tech Stack & Tools

### 💻 Languages
<div align="center">
${stats.languageStats.slice(0, 8).map(lang =>
        `<img src="https://img.shields.io/badge/-${encodeURIComponent(lang.name)}-${lang.color.replace('#', '')}?style=for-the-badge&logo=${getLanguageLogo(lang.name)}&logoColor=white" alt="${lang.name}" />`
    ).join('\n')}
</div>

### 🔧 Frameworks & Libraries
<div align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js" />
</div>

### 🗄️ Databases & Cloud
<div align="center">
  <img src="https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
</div>

---

## 📈 Contribution Stats

### 🔥 Streak & Activity
<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="https://github-readme-activity-graph.vercel.app/graph?username=${username}&theme=tokyo-night&hide_border=true&area=true" alt="Activity Graph" />
      </td>
    </tr>
  </table>
</div>

### ⏰ Coding Time Distribution
<details>
<summary><b>📊 最もアクティブな時間帯 (クリックして展開)</b></summary>
<br>
<div align="center">

\`\`\`
時間別コミット分布 (過去1年間)
${Object.entries(stats.commitsByHour).map(([hour, count]) => {
        const maxCount = Math.max(...Object.values(stats.commitsByHour));
        const barLength = Math.round((count / maxCount) * 30);
        const bar = '█'.repeat(barLength || 1);
        const percentage = maxCount > 0 ? ((count / stats.yearlyCommits) * 100).toFixed(1) : '0.0';
        return `${hour.padStart(2, '0')}時 ${bar} ${count} commits (${percentage}%)`;
    }).join('\n')}
\`\`\`

**🌟 最もアクティブ**: ${stats.mostActiveHour} | **📅 最も活発な曜日**: ${stats.mostActiveDay}

</div>
</details>

---

## 🏆 GitHub Achievements

<div align="center">
  <img src="https://github-profile-trophy.vercel.app/?username=${username}&theme=tokyonight&no-frame=true&column=7&margin-w=15&margin-h=15" alt="GitHub Trophies" />
</div>

---

## 📌 Featured Projects

<div align="center">
  <table>
    <tr>
${stats.topRepos.slice(0, 2).map((repo, index) => `      <td width="50%">
        <h3 align="center">${index === 0 ? '🥇' : '🥈'} ${repo.name}</h3>
        <div align="center">
          <a href="${repo.url}">
            <img src="https://github-readme-stats.vercel.app/api/pin/?username=${username}&repo=${repo.name}&theme=tokyonight&hide_border=true" alt="${repo.name}" />
          </a>
          <p><strong>${repo.language || 'Mixed'}</strong> • ⭐ ${repo.stars} • 🍴 ${repo.forks}</p>
          ${repo.description ? `<p><i>${repo.description}</i></p>` : ''}
          ${repo.topics && repo.topics.length > 0 ? `<p>${repo.topics.slice(0, 5).map(t => `<code>${t}</code>`).join(' ')}</p>` : ''}
        </div>
      </td>`).join('\n')}
    </tr>
    <tr>
${stats.topRepos.slice(2, 4).map((repo, index) => `      <td width="50%">
        <h3 align="center">${index === 0 ? '🥉' : '🏅'} ${repo.name}</h3>
        <div align="center">
          <a href="${repo.url}">
            <img src="https://github-readme-stats.vercel.app/api/pin/?username=${username}&repo=${repo.name}&theme=tokyonight&hide_border=true" alt="${repo.name}" />
          </a>
          <p><strong>${repo.language || 'Mixed'}</strong> • ⭐ ${repo.stars} • 🍴 ${repo.forks}</p>
          ${repo.description ? `<p><i>${repo.description}</i></p>` : ''}
        </div>
      </td>`).join('\n')}
    </tr>
  </table>
</div>

<div align="center">
  <a href="https://github.com/${username}?tab=repositories">
    <img src="https://img.shields.io/badge/すべてのプロジェクトを見る-100000?style=for-the-badge&logo=github&logoColor=white" alt="View All Projects" />
  </a>
</div>

---

## 📊 Detailed Statistics

<details>
<summary><b>📈 詳細な統計情報を表示 (クリックして展開)</b></summary>
<br>

### 💼 Overall Stats
<div align="center">
  <table>
    <tr>
      <td align="center">
        <b>📦 Total Repositories</b><br/>
        <img src="https://img.shields.io/badge/Total-${stats.totalRepos}-blue?style=flat-square" alt="Total Repos" /><br/>
        <sub>Public: ${stats.publicRepos} | Private: ${stats.privateRepos}</sub>
      </td>
      <td align="center">
        <b>⭐ Total Stars</b><br/>
        <img src="https://img.shields.io/badge/Stars-${stats.totalStars}-yellow?style=flat-square" alt="Stars" /><br/>
        <sub>Across all repositories</sub>
      </td>
      <td align="center">
        <b>🍴 Total Forks</b><br/>
        <img src="https://img.shields.io/badge/Forks-${stats.totalForks}-orange?style=flat-square" alt="Forks" /><br/>
        <sub>Community contributions</sub>
      </td>
    </tr>
    <tr>
      <td align="center">
        <b>💻 Code Changes</b><br/>
        <img src="https://img.shields.io/badge/++${stats.totalCodeAdditions.toLocaleString()}-green?style=flat-square" alt="Additions" />
        <img src="https://img.shields.io/badge/--${stats.totalCodeDeletions.toLocaleString()}-red?style=flat-square" alt="Deletions" /><br/>
        <sub>Lines added/removed</sub>
      </td>
      <td align="center">
        <b>🔀 Pull Requests</b><br/>
        <img src="https://img.shields.io/badge/PRs-${stats.totalPRs}-purple?style=flat-square" alt="PRs" /><br/>
        <sub>Code reviews & contributions</sub>
      </td>
      <td align="center">
        <b>🐛 Issues</b><br/>
        <img src="https://img.shields.io/badge/Issues-${stats.totalIssues}-critical?style=flat-square" alt="Issues" /><br/>
        <sub>Reported & resolved</sub>
      </td>
    </tr>
  </table>
</div>

### 🗂️ Language Breakdown
<div align="center">
  <table>
    <tr>
      <th>Language</th>
      <th>Usage</th>
      <th>Projects</th>
      <th>Lines</th>
    </tr>
${stats.languageStats.map(lang => `    <tr>
      <td><img src="https://img.shields.io/badge/-${encodeURIComponent(lang.name)}-${lang.color.replace('#', '')}?style=flat-square&logo=${getLanguageLogo(lang.name)}&logoColor=white" alt="${lang.name}" /></td>
      <td><img src="https://progress-bar.dev/${Math.round(lang.percentage)}/?title=${lang.percentage}%25&width=150" alt="Usage" /></td>
      <td>${Math.round(lang.percentage * stats.totalRepos / 100)}</td>
      <td>${(lang.bytes / 1024).toFixed(1)}KB</td>
    </tr>`).join('\n')}
  </table>
</div>

</details>

---

## 🌟 Connect with Me

<div align="center">
  <a href="https://github.com/${username}">
    <img src="https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" />
  </a>
  <a href="mailto:${stats.user.email || `${username}@example.com`}">
    <img src="https://img.shields.io/badge/Email-D14836?style=for-the-badge&logo=gmail&logoColor=white" alt="Email" />
  </a>
  ${stats.user.twitter_username ? `<a href="https://twitter.com/${stats.user.twitter_username}">
    <img src="https://img.shields.io/badge/Twitter-1DA1F2?style=for-the-badge&logo=twitter&logoColor=white" alt="Twitter" />
  </a>` : ''}
  ${stats.user.blog ? `<a href="${stats.user.blog}">
    <img src="https://img.shields.io/badge/Website-FF5722?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Website" />
  </a>` : ''}
</div>

---

<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=24&height=100&section=footer&fontSize=90" alt="Footer" />
</div>

<div align="center">
  <h3>💖 Thank you for visiting my profile!</h3>
  <p>
    <i>🔄 Last Updated: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST</i><br/>
    <i>⚡ Auto-updated via GitHub Actions</i>
  </p>
</div>

<!-- STATS:END -->`;

    // READMEを更新
    const startTag = '<!-- STATS:START -->';
    const endTag = '<!-- STATS:END -->';
    const startIndex = readme.indexOf(startTag);
    const endIndex = readme.indexOf(endTag) + endTag.length;

    if (startIndex !== -1 && endIndex !== -1) {
        readme = readme.substring(0, startIndex) + statsSection + readme.substring(endIndex);
    } else {
        // タグが見つからない場合は末尾に追加
        readme += '\n\n' + statsSection;
    }

    await fs.writeFile(readmePath, readme);
    console.log('✅ README.mdを更新しました！');
}

// 言語のロゴを取得
function getLanguageLogo(lang) {
    const logos = {
        JavaScript: 'javascript',
        TypeScript: 'typescript',
        Python: 'python',
        Java: 'java',
        'C++': 'cplusplus',
        'C#': 'csharp',
        PHP: 'php',
        Ruby: 'ruby',
        Go: 'go',
        Rust: 'rust',
        Swift: 'swift',
        Kotlin: 'kotlin',
        Dart: 'dart',
        HTML: 'html5',
        CSS: 'css3',
        SCSS: 'sass',
        Vue: 'vuedotjs',
        React: 'react',
        Shell: 'gnubash',
        PowerShell: 'powershell',
        Dockerfile: 'docker',
        'Jupyter Notebook': 'jupyter'
    };
    return logos[lang] || 'github';
}

// メイン実行
async function main() {
    try {
        const stats = await getDetailedStats();
        await updateReadme(stats);
        console.log('🎉 すべての処理が完了しました！');
    } catch (error) {
        console.error('💥 エラーが発生しました:', error);
        process.exit(1);
    }
}

main();
