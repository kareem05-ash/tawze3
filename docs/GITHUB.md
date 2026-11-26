# Putting the project on GitHub

Nothing secret is in the repository: `.gitignore` excludes `node_modules`, builds, `*.keystore`, `*.jks`, `android/keystore.properties`, `local.properties`, database files and `.env`.
Double-check with `git status` before every commit that no keystore or password file is listed.

## Option A: GitHub website + Git
```bash
cd tawze3
git init -b main
git add .
git status                      # review the list
git commit -m "Initial commit: tawze3"
```
Create an EMPTY repository on github.com (no README), then:
```bash
git remote add origin https://github.com/<your-user>/tawze3.git
git push -u origin main
```
## Option B: GitHub CLI
```bash
gh auth login
gh repo create tawze3 --private --source=. --remote=origin --push
```
Use a **private** repository: the code is yours and contains the business formulas.

## Daily workflow
```bash
git add -A && git commit -m "feat: ..." && git push
```
Never commit the keystore. Back it up separately (see ANDROID.md).
