# 🚀 Quick Start Guide - Running Drasill Cloud

## Current Status
✅ **Built Successfully** - All TypeScript compiled without errors  
⚠️ **Location:** Dev Container (no GUI environment)

---

## Running the Application

### 🖥️ **On Your Local Machine (Recommended)**

1. **Clone the repository locally:**
   ```bash
   git clone https://github.com/StephenRoma/Drasill-Cloud.git
   cd Drasill-Cloud
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start development mode:**
   ```bash
   npm run dev
   ```

4. **The app will launch!** 🎉

---

### 📦 **Build Production Package**

```bash
# From project root
npm run package
```

This creates an installer in:
- Windows: `apps/desktop/out/Drasill Cloud Setup-x.x.x.exe`
- macOS: `apps/desktop/out/Drasill Cloud-x.x.x.dmg`
- Linux: `apps/desktop/out/Drasill Cloud-x.x.x.AppImage`

---

## Testing the Schematic Visualizer

### **Once the app is running:**

1. **Open DevTools:** Press `F12` or `Ctrl+Shift+I`

2. **Run test command in console:**
   ```javascript
   // Test opening a schematic tab
   window.useAppStore.getState().openSchematicTab({
     component_name: "Hydraulic Pump",
     machine_model: "HX-2000"
   });
   ```

3. **Expected result:**
   - A new tab appears with a 🔧 icon
   - Schematic viewer opens in main area
   - Mock data displays (since Java service isn't running)
   - Zoom controls are functional
   - Service instructions visible in side panel

### **Or use the test page:**

1. In the app, open the command palette (`Ctrl+P`)
2. Navigate to and open `schematic-test.html`
3. Click "Open Test Schematic" button
4. View the schematic viewer in action!

---

## 📋 Available Commands

```bash
# Development
npm run dev          # Start app in dev mode with hot-reload

# Building
npm run build        # Build TypeScript files
npm run package      # Create distributable package

# Code Quality
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run typecheck    # Type check without building
```

---

## 🔧 Java REST API Setup (For Real Data)

The schematic visualizer works in **mock mode** by default. To use real schematics:

1. **Create Java REST API with these endpoints:**
   - `POST http://localhost:8080/tool-call` - Process schematic requests
   - `GET http://localhost:8080/health` - Health check

2. **Start the Java service:**
   ```bash
   java -jar SchematicToolHandler.jar
   ```

3. **Test in the app:**
   - The schematic viewer will automatically use real data
   - Images will load from your RAG system
   - Service instructions from your database

**See `SCHEMATIC_VISUALIZER_README.md` for Java implementation details.**

---

## 🐛 Troubleshooting

### **"Cannot open shared object file" error**
This happens in headless environments (like dev containers).

**Solution:** Run on a machine with a GUI environment.

### **Port 5173 already in use**
Another Vite server is running.

**Solution:** 
```bash
# Kill the process using the port
npx kill-port 5173

# Or use a different port
PORT=5174 npm run dev
```

### **Electron doesn't launch**
Missing display environment.

**Solution:** 
- Run on local machine with GUI
- Use GitHub Codespaces with desktop preview
- Build package and test on another machine

---

## 🧪 Verifying the Build (Without Running)

Since you're in a dev container, you can verify everything is ready:

```bash
# Check built files exist
ls apps/desktop/dist/main/schematic.js        # ✅ Should exist
ls apps/desktop/dist/renderer/index.html      # ✅ Should exist

# Check for TypeScript errors
npm run typecheck                              # ✅ Should pass

# View what was built
cat apps/desktop/dist/main/schematic.js        # See compiled code
```

---

## 📁 Project Structure

```
Drasill-Cloud/
├── apps/desktop/              # Main Electron app
│   ├── main/                  # Main process (Node.js)
│   │   └── schematic.ts       # ✨ Schematic handler
│   ├── renderer/              # Renderer process (React)
│   │   └── components/
│   │       └── SchematicViewer.tsx  # ✨ Viewer component
│   └── dist/                  # Built files
├── packages/shared/           # Shared types
└── schematic-test.html       # ✨ Test page

✨ = Newly added for schematic visualizer
```

---

## 🎯 Next Steps

1. **Run locally:** Clone to your machine and `npm run dev`
2. **Test schematic viewer:** Use console commands or test page
3. **Set up Java service:** For real data integration
4. **Configure OpenAI:** Add retrieve_schematic function
5. **Integrate with chat:** Wire up tool call handler

---

## 📚 Documentation

- **Setup Guide:** `SCHEMATIC_SETUP_GUIDE.md`
- **Full Documentation:** `SCHEMATIC_VISUALIZER_README.md`
- **Test Report:** `IMPLEMENTATION_TEST_REPORT.md`
- **Code Examples:** `apps/desktop/renderer/src/examples/schematic-integration.example.ts`

---

## ✅ You're All Set!

The schematic visualizer is **fully implemented and built**. Just run it on a machine with a GUI to see it in action! 🚀

**Quick Command:**
```bash
git push  # Push your changes
git clone <repo> ~/local-drasill  # Clone on local machine
cd ~/local-drasill && npm install && npm run dev
```
