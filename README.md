# Connection Job Highlighter - Chrome Extension

This browser extension helps you leverage your professional network in your job search. It works by automatically highlighting job postings on LinkedIn from companies where you already have a connection.

## How It Works

1.  **Download Your Connections:** Go to your LinkedIn settings (`Data Privacy` > `Get a copy of your data`) and download your **Connections** as a `.csv` file. Make sure this CSV contains a "URL" column with the LinkedIn profile URLs of your connections.
2.  **Upload to the Extension:** Open the extension's sidebar on a LinkedIn Jobs page and upload the `Connections.csv` file you just downloaded. The extension will process your connections in the background.
3.  **Find Opportunities:** As you browse job listings on LinkedIn, the extension will automatically highlight jobs from companies where your connections work, giving you a clear signal of where you have a "warm" lead.

## Getting Started (for Development)

To run and test this extension locally, follow these steps:

1.  **Install Dependencies:**
    ```bash
    pnpm install
    ```

2.  **Run the Development Server:**
    ```bash
    pnpm dev
    ```
    This command will watch for file changes and rebuild the extension automatically.

3.  **Load the Extension in Your Browser:**
    *   Open Chrome and navigate to `chrome://extensions`.
    *   Enable **"Developer mode"** using the toggle switch in the top-right corner.
    *   Click the **"Load unpacked"** button.
    *   Select the `build/chrome-mv3-dev` directory from this project. The extension should now appear in your list of extensions.

You can now navigate to a [LinkedIn Jobs](https://www.linkedin.com/jobs/) page to start testing.

## Production Build

To create a production-ready version of the extension, run the following command:

```bash
pnpm build
```

This will create a production-optimized build in the `build/chrome-mv3-prod` directory. You can then zip the contents of this directory and upload it to the Chrome Web Store.