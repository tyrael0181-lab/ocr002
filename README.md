# 🎨 Slide Patcher

AI（NotebookLM等）が生成したスライド画像を、まるで魔法のように「編集可能なスライド」に修正・再出力するツールです。

## 🚀 Live Demo
[Slide Patcher を使ってみる](https://tyrael0181-lab.github.io/ocr002/)

## 📖 使い方 (Manual)
[初心者向け使い方ガイド](./USER_GUIDE.md)

## ✨ 主な機能
- **隠す (Mask)**: 修正テープ（白塗り）で不要な部分を消去
- **書く (Text)**: 好きな場所に新しいテキストを配置
- **読み取る (Magic OCR)**: スライド内の文字をAIが解析し、即座に編集可能なテキストに変換
- **戻す (Export)**: レイヤー構造を保ったまま **PowerPoint (.pptx)** や **PDF** として書き出し

## 🔒 セキュリティ
全ての処理（PDF解析、OCR、ファイル生成）はユーザーのブラウザ内で行われます。データが外部サーバーに送信されることはありません。

## 🛠 開発者向け
Vite + React + TypeScript で構築されています。

### 起動
```bash
npm install
npm run dev
```

### ビルド & デプロイ
```bash
npm run build
npm run deploy
```
