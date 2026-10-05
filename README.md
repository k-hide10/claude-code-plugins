# claude-code-plugins

hide10が作ったClaude Codeのプラグイン（mod、Skillなど）の配布場所です。
どれも単独で入れられます。1つ入れても、ほかのプラグインは入りません。

## 置いているプラグイン

| プラグイン | 種類 | できること |
|---|---|---|
| [effort-auto](plugins/effort-auto/) | mod | 依頼の難しさをHaikuが判定し、Claudeの考える深さを依頼ごとに自動で切り替える |

## 入れ方

Claude Codeの入力欄で、入れたいプラグインの名前を指定して実行します。

```
/plugin install effort-auto --marketplace k-hide10/claude-code-plugins
```

シェルから入れる場合は、最初に一度だけこのリポジトリを登録し、あとはプラグインごとに入れます。

```
claude plugin marketplace add k-hide10/claude-code-plugins
claude plugin install effort-auto@hide10
```

更新が出たときは `claude plugin update effort-auto@hide10` で最新版になります。

## ライセンス

MIT
