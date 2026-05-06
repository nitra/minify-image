<!-- Цей файл генерується автоматично через `npx @nitra/cursor`. Не редагуй вручну. -->

@.cursor/rules/n-bun.mdc
@.cursor/rules/n-changelog.mdc
@.cursor/rules/n-ga.mdc
@.cursor/rules/n-js-lint.mdc
@.cursor/rules/n-js-run.mdc
@.cursor/rules/n-npm-module.mdc
@.cursor/rules/n-text.mdc

## Лінт і ESLint (без паралельних запусків)

Щоб не запускати **кілька** одночасних **`eslint`** (і не перевантажувати диск/CPU), **заборонено** стартувати `bun run lint` / `lint-js` / `eslint` **паралельно** в різних Bash-задачах, **фонових** shells чи **субагентах** (Task тощо). Має бути **один** послідовний прогон на сесію; команда **`/n-lint`** — **не** ділити на паралельні підзадачі. Деталі: `.cursor/skills/n-lint/SKILL.md`.

## Skills

- `.cursor/skills/n-fix/SKILL.md` — Виправити проєкт відповідно до всіх правил в .cursor/rules/
  Команда: `/n-fix`
- `.cursor/skills/n-lint/SKILL.md` — Запустити кореневий bun run lint, виправити порушення й підтвердити чистий вихід
  Команда: `/n-lint`
