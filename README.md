[Hux Blog](https://huangxuan.me)
================================

> I never expected this to become popular.

![](http://huangxuan.me/img/blog-desktop.jpg)


[User Manual 👉](_doc/Manual.md)
--------------------------------------------------

### Getting Started

1. You will need [Ruby](https://www.ruby-lang.org/en/) and [Bundler](https://bundler.io/) to use [Jekyll](https://jekyllrb.com/). Following [Using Jekyll with Bundler](https://jekyllrb.com/tutorials/using-jekyll-with-bundler/) to fullfill the enviromental requirement.

2. Installed dependencies in the `Gemfile`:

```sh
$ bundle install 
```

3. Serve the website (`localhost:4000` by default):

```sh
$ bundle exec jekyll serve  # alternatively, npm start
```

### Development (Build From Source)

To modify the theme, you will need [Grunt](https://gruntjs.com/). There are numbers of tasks you can find in the `Gruntfile.js`, includes minifing JavaScript, compiling `.less` to `.css`, adding banners to keep the Apache 2.0 license intact, watching for changes, etc. 

Yes, they were inherited and are extremely old-fashioned. There is no modularization and transpilation, etc.

Critical Jekyll-related code are located in `_include/` and `_layouts/`. Most of them are [Liquid](https://github.com/Shopify/liquid/wiki) templates.

This theme uses the default code syntax highlighter of jekyll, [Rouge](http://rouge.jneen.net/), which is compatible with Pygments theme so just pick any pygments theme css (e.g. from [here](http://jwarby.github.io/jekyll-pygments-themes/languages/javascript.html) and replace the content of `highlight.less`.


### Interesting to know more? Checkout the [full user manual](_doc/Manual.md)!


Other Resources
---------------

Ports
- [**Hexo**](https://github.com/Kaijun/hexo-theme-huxblog) by @kaijun
- [**React-SSR**](https://github.com/LucasIcarus/huxpro.github.io/tree/ssr) by @LucasIcarus

[Starter/Boilerplate](https://github.com/huxpro/huxblog-boilerplate)
- Out of date. Helps wanted for updating it on par with the main repo

Translation
- [🇨🇳  中文文档（有点过时）](https://github.com/Huxpro/huxpro.github.io/blob/master/_doc/README.zh.md)


新增文章流程
-----------

### 1. 建立文章

在 `_posts/` 資料夾新增 Markdown 檔案，檔名格式為 `YYYY-MM-DD-文章標題.md`：

```
_posts/2026-03-03-my-post.md
```

文章開頭需加上 Front Matter：

```yaml
---
layout:       post
title:        "文章標題"
author:       "Acheng"
header-style: text
catalog:      true
tags:
    - 標籤1
    - 標籤2
---

文章內容從這裡開始...
```

### 2. 附加檔案（如有 demo 或附件）

在 `files/` 資料夾下建立與文章同名的子資料夾，將相關檔案放入：

```
files/
└── 2026-03-03-my-post/
    ├── index.html
    ├── demo.js
    └── example.json
```

在文章中用以下格式連結：

```markdown
[查看 Demo](/files/2026-03-03-my-post/index.html)
[下載範例](/files/2026-03-03-my-post/example.json)
```

### 3. 部署

commit + push 到 `master`，GitHub Actions 自動 build，幾分鐘後網站更新。

```
_posts/ 新增文章 → commit → push to master → GitHub Actions build → 網站更新
```

License
-------

Apache License 2.0.
Copyright (c) 2015-present Huxpro

Hux Blog is derived from [Clean Blog Jekyll Theme (MIT License)](https://github.com/BlackrockDigital/startbootstrap-clean-blog-jekyll/)
Copyright (c) 2013-2016 Blackrock Digital LLC.
