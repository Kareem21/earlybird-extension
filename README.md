# Connection Job Finder - Chrome Extension

This browser extension helps you leverage your professional network in your job search. It works by highlighting job postings on LinkedIn from companies where you already have a connection, giving you a clear signal of where you have a "warm" lead.

## How It Works

1.  **Download Your Connections:** Go to your LinkedIn settings (`Data Privacy` > `Get a copy of your data`) and download your **Connections** as a `.csv` file.
2.  **Upload to the Extension:** Open the extension's sidebar on the LinkedIn jobs page and upload the `connections.csv` file you just downloaded.
3.  **Find Opportunities:** The extension will automatically highlight jobs from companies where your connections work, both on the main LinkedIn page and within the extension's sidebar. You can also filter the list to see only jobs where you have a connection.

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

You can now navigate to the [LinkedIn Jobs](https://www.linkedin.com/jobs/) page to start testing.