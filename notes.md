Tripping points:

- Opening a meeting url showed a popup to open the meeting on the desktop app. Playwright can't interact with this modal because its outside of browser scope. Instead, modify launch url to skip the dialog
