# Trinket

An open source, browser-based coding environment designed for education.

Trinket lets students and educators write and run code directly in the browser, supporting multiple programming languages including Python, HTML, Java, R, and more.

## Features

- **Browser-based code editor** - Write and run code without installing anything
- **Multiple language support** - Python, HTML/CSS/JS, Java, R, GlowScript, and more
- **Embeddable trinkets** - Embed interactive code examples in any webpage
- **Course creation** - Build interactive coding courses and tutorials
- **Code sharing** - Share and remix code with others

## Technology

- **Backend** - Node.js 22 LTS with hapi 21
- **Database** - MongoDB via the Mongoose ODM
- **Sessions** - iron-sealed cookies via hapi's Yar plugin, backed by **MongoDB**, not Redis. The server registers a
  `sessions` cache whose engine is the in-repo `lib/util/catbox-mongoose.js`, so sessions survive a restart with no
  Redis involved and Redis being switched off does not sign anyone out
- **Application cache/queues** - Redis, genuinely optional, with an in-memory fallback when disabled: the store layer
  under `lib/util/store/` serves the same operations from memory, and every background queue but the export queue is
  hard-disabled regardless
- **Frontend** - AngularJS 1.x
- **Code Execution** - Skulpt for Python in the browser; server-side container runners for other languages

## License

This project is released under CC0 1.0 Universal (Public Domain Dedication). See the [LICENSE](https://github.com/Blitzy-Sandbox/blitzy-trinket-oss/blob/main/LICENSE) file for details.

## History

Trinket was originally created by Elliott Hauser and Brian Marks to make coding education accessible to everyone. It is now open source and maintained by the community.
