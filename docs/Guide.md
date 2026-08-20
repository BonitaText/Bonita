## Guide for all Folders

This guide exists for folks to have success when learning how to work with the codebase.

## `text-reader-app/frontend`
YOU HAVE TO BE IN THIS FILE TO RUN ANY NPM COMMANDS. Any programming however, will primarily be done in the src folder, feel free to skip to that.
### Easily explained folders within
- [OBSOLETE] `/bug_documentation/...` - This folder contains early documentation for bugs but has now been replaced by our implementation board in the repo `BonitaText/Projects/Implementation Board`
  
- [IGNORE] `/coverage/...` - This folder deals with all coverage calculations and output. The coverage report can be viewed in repo website.
  
- `/dist/...` - This folder is updated when running `npm run build`, it contains the distributable code that needs to be zipped and "load unpacked" when adding it to your browser.
  
- [IGNORE] `/docs/...` - Like `coverage`, this folder handles all the typedocs output which is best viewed in repo website.
  
- [IGNORE] `/node_modules/...` - This folder is created when running `npm run build`, occasionally your branch can have issues merging with main because of version mismatches etc, but you will never have to touch anything in the folder directly.
  
- `/public/...` - Contains images, scripts, icons that don't ever change during the build process. In our case the logo is here, and the dyslexic font.
  
- [IGNORE] `/release/...` - Where npm stores the production ready zip. Similar to dist but way more compact. The crx-frontend-1.0.0.zip file inside this folder is ready to be uploaded directly to the Chrome Web Store or distributed manually.
  
- [IGNORE] `/workers/...` - handles all of the reports sent to github
  
- [IGNORE] `.gitattributes` - contains 2 lines basically saying "always choose new version of these files".
  
- `.gitignore` - Any files listed in this one will never be pushed to github repo.
  
- `manifest.config.ts` - You will probably touch this very little. It's for defining metadata, permissions, action icons, and background scripts for MV3 (Manifest V3) extensions using helper functions like defineManifest.
  
- [IGNORE] `package-lock.json` - This file is generated using `package.json` when running `npm install` or `npm ci`, never edit this directly.
  
- `package.json` - The single source of truth for managing project dependencies, executing tasks, and storing project metadata
  
- [IGNORE] any and all files that have "config" in it, and the `typedoc.json`, if they are giving issues consult with Erika.

### `text-reader-app/frontend/src`
The real meat of the project, this folder contains all of our code that makes up the extension.

- `/assets/...` - Similar to `public`, this folder contains images and scripts that remain unchanged.
  
- `/background/...` - Contains the background service worker, its job is to make cross-origin requests that content scripts can't do reliably.
  
- [IMPORTANT] `/content/...` - Please see dedicated content section lower down. This folder contains ALL the code that pertains to the TOOL BAR, and absolutely has nothing to do with the popup.
  
- [IMPORTANT] `/popup/...` - Please see dedicated popup beneath content section. This folder contains all code that pertains to the popup where settings are toggled and reports are made.
  
- `/scripts/...` - Contains any scripts that don't run while the extension itself is working, for example `buildMeshterms.ts` was used once to create MeshTerms file and is now there incase we ever need to do that again.
  
- `/shared/...` - Contains `settings.ts` a file that defines BonitaSettings shape, default values and storage helpers used by every part of the extension.
  
- [IMPORTANT] `/test/...` - As the name suggests, this folder contains all the tests for all the codes. Tests for each file are kept in a folder named the exact same as the non-test files.

#### `text-reader-app/frontend/src/content`
This folder has everything to do with the toolbar (also called the dock, and floating button). Files within folders are basically named based on the tools they depend on. Except in `hooks/useReadingTools.ts` actually deals with the logic of sentence splitting, phrase bolding, word simplifying, and POS highlighting. A "ReadingTools" file won't appear in `utils` but will show up in `views`.

- `content/hooks/` - Glue layer that watches user settings and calls into `utils/`. Little backend logic.

- `content/utils/` — **ALMOST ALL BACKEND LOGIC HERE** - Each file = one feature. They take the page DOM as input, mutate it, and have a corresponding "remove" to undo.\
    *If I want to fix bolding logic, I look here.*

- `content/views/` - Visual UI pieces (the dock, toggles, popup menus). Has NOTHING to do with backend logic whasoever.\
*If I want to fix a weird bug that happens when I am interacting with the UI itself, it will be fixed here.*
    - `App.tsx` - like the "main function" of this folder, it puts all the tools UI code together to create toolbar. Any issues with the toolbar as a whole will be dealt with here.


- `content/main.tsx` - Entry point — boots the whole content script.

#### `text-reader-app/frontend/src/popup`
MUCH more simple then the content folder. This is a popup that appears when you click the extension icon at the very top of the page (NOT THE FLOATING BUTTON). It's used to select which tools are allowed in the toolbar. 

- `App.tsx` - handles all of the tool toggling and UI for the popup with `index.css`.

- `ReportIssue.tsx` - Just deals with the report section in the popup.

Hope this guide helps understand the code better, have a happy time coding :)


