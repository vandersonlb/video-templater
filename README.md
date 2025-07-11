# Video Project Manager

A web-based application for managing video projects with template-based video generation using NexRender.

## Features

- **Project Management**: Create, list, and manage multiple video projects
- **Template Integration**: Select from available .aep template files
- **Data Management**: 
  - Download empty CSV data models
  - Upload populated CSV files with project data
  - Generate video render jobs for each CSV row
- **Material Design UI**: Clean, responsive interface using Google's Material Design
- **Browser Storage**: Projects persist in browser localStorage (no database required)

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. Clone or download the project files
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:8080
   ```

## Usage

### Creating a Project

1. Click the "New Project" floating action button
2. Enter a project name
3. Select a template from the available options
4. Define data columns for your project (auto-populated from template fields)
5. Click "Create Project"

### Managing Project Data

#### Download Data Model
- Click "Download Model" on any project card
- Downloads an empty CSV file with the project's column headers
- Use this as a template to populate your data

#### Upload Data Source
- Click "Upload Data" on any project card
- Select or drag-and-drop a CSV file with your project data
- The CSV must match the project's defined columns

#### Generate Videos
- Click "Generate Videos" on projects with uploaded data
- Creates render job configurations for each CSV row
- Jobs are prepared for processing with NexRender

## Project Structure

```
video-project-manager/
├── server.js              # Express server
├── package.json           # Dependencies and scripts
├── public/                # Static web files
│   ├── index.html        # Main application page
│   ├── css/
│   │   └── styles.css    # Material Design styling
│   └── js/
│       ├── app.js        # Main application logic
│       ├── projects.js   # Project management
│       └── utils.js      # Utility functions
├── uploads/              # Temporary CSV uploads
└── demo_template_*.json  # Template configuration files
```

<!--
## Templates

The application automatically detects template files in the root directory:
- Files must follow the pattern: `demo_template_*.json`
- Templates define the NexRender configuration and available data fields
- Currently includes:
  - `demo_template_01.json` - Sale template with product/price fields
  - `demo_template_02.json` - Alternative sale template configuration
-->

## API Endpoints

- `GET /` - Serve main application
- `GET /api/templates` - List available templates
- `POST /api/upload-csv` - Upload CSV data file
- `GET /api/download-csv/:projectId` - Download empty CSV template
- `POST /api/generate-videos` - Generate video render jobs

## Data Storage

- Projects are stored in browser localStorage
- No database required
- Data persists between browser sessions
- CSV files are temporarily stored on server during upload processing

## Technology Stack

- **Backend**: Node.js, Express.js
- **Frontend**: HTML, CSS, JavaScript
- **UI Framework**: Material Design Components for Web
- **File Processing**: Multer, csv-parser, csv-writer
- **Storage**: Browser localStorage

## Development

To run in development mode with auto-restart:

```bash
npm run dev
```

## Notes

- The application prepares render job configurations but does not execute actual video rendering
- To process videos, you would need to integrate with NexRender
- Template files should be placed in the root directory
- The server runs on port 8080 by default

## Browser Compatibility

- Modern browsers with ES6+ support
- Chrome, Firefox, Safari, Edge (latest versions)
- Requires JavaScript enabled

## Run test local

```bash
nexrender-cli -f test_local.json -m "Z" -b "/mnt/d/Adobe/Adobe After Effects 2025/Support Files/aerender.exe" -w "/mnt/d/Adobe/_cache_/Nexrender" --skip-cleanup
```
