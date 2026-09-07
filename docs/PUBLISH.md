# PUBLISH · GitHub发布前清单（视情况）

## 现状：可发布
- 双域200 v0.4.0 8种，D1 5表，LICENSE MIT+声明，/.gitignore已含node/.dev.vars/.wrangler
- 唯一账号相关：`worker/wrangler.toml database_id`（非密钥，无Token不可用，但公开前建议脱敏）

## 发布前3步（我可代跑，需你给空仓地址）
1. 脱敏：`cp worker/wrangler.toml worker/wrangler.example.toml`，example里`database_id="REPLACE_ME"`，README加“自建D1后填ID”
2. 建仓推：
```bash
cd /sdcard/Download/Operit/projects/lottery-web
git init -b main
git add .; git commit -m \"lottery-web v0.4.0 self-use 8 lotteries\"
git remote add origin <你空仓URL>
git push -u origin main
```
3. Pages/验证：前端`frontend/`单独发Pages/Vercel，Worker保持现网，`/health`回归。

## 不发什么
- 不发Token/Account：代码里无`cfut_`，已扫，仅`database_id`按上脱敏
- 不发APK原包逻辑：自研实现，无反编译代码

你要发，给我空仓URL，我执行2并回验证。