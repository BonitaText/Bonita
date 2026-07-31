### To run tests but no UI
```
npm test
```

### To run tests with UI
```
npm run test:ui
```

### To run a clean install
```
npm ci
```

### npm ci common failures
When creating a PR sometimes you will have conflicts with mains `package.json` and `package-lock.json`.

These will cause all git actions to fail as npm ci can't run.

If this happens, merge main with your branch first, then resolve the conflicts in your branch making sure that `package.json` makes sense.

`package-lock.json` is a file generated using `package.json` when you run npm install. Rerunning npm install won't fix all the problems, you will first have to remove `node_modules`, remove `package-lock.json`, and then run npm install, finally run `npm ci` to make sure it worked.

Here are the windows commands you can run within frontend:
```
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
npm ci
```
