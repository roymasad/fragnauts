import { Engine, Scene, Vector3, HemisphericLight, DirectionalLight, ArcRotateCamera, Mesh, Matrix, Color3, Space, MeshBuilder, AxesViewer, StandardMaterial, CubeTexture, Texture } from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";
import "@babylonjs/loaders/glTF";
import { Planet } from './Planet';
import { Player } from './Player';
import { MultiplayerManager } from './MultiplayerManager';

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;
    private planet: Planet;
    private player: Player;
    private camera!: ArcRotateCamera;
    private isThirdPersonMode: boolean = true;
    private planetOrbitHeight: number = 10;
    private thirdPersonDistance: number = 3;
    private thirdPersonHeight: number = 1.5;
    private cameraTransitionSpeed: number = 0.05;
    private debugMode: boolean = false;
    private axesViewer: AxesViewer | null = null;
    private lastFrameTime: number = Date.now();
    private _keyboardInitialized: boolean = false;
    private _keysPressed: Set<string> = new Set<string>();
    private _lastLKeyPress: number = 0;
    private _lKeyPressDelay: number = 250; // Minimum delay between shots in milliseconds
    private _lKeyWasPressed: boolean = false; // New flag to track if L key was already pressed
    private frags: number = 0; // Track player's frags
    private fpsText!: GUI.TextBlock; // FPS counter
    private fragsText!: GUI.TextBlock; // Frags counter
    private fuelBar!: GUI.Rectangle; // Fuel bar background
    private fuelBarFill!: GUI.Rectangle; // Fuel bar fill
    private fuelText!: GUI.TextBlock; // Fuel percentage text
    private lastMouseX: number | null = null; // Changed to nullable to handle first movement
    private mouseSensitivity: number = 0.005;
    private debugMouseRotation: boolean = false;
    private _mouseMovement: number = 0; // Store mouse movement for processing
    private isPointerLocked: boolean = false; // Track pointer lock state
    
    // Multiplayer manager reference
    private multiplayerManager: MultiplayerManager | null = null;

    constructor() {
        // Create the canvas and engine
        this.canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
        this.engine = new Engine(this.canvas, true);

        // Track pointer lock state
        this.isPointerLocked = false;

        // Handle pointer lock state changes
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === this.canvas;
        });

        // Ensure canvas is properly set up for input with error handling
        this.canvas.addEventListener('click', async () => {
            if (!this.isPointerLocked) {
                try {
                    await this.canvas.requestPointerLock();
                } catch (error) {
                    console.warn('Failed to acquire pointer lock:', error);
                    // Continue without pointer lock - game will still work but with reduced functionality
                }
            }
        });

        // Create the scene
        this.scene = new Scene(this.engine);

        // Create directional light for sun-like effect
        const sunLight = new DirectionalLight("sunLight", new Vector3(1, 1, 1), this.scene);
        sunLight.intensity = 1.0;
        sunLight.position = new Vector3(100000, 100000, 100000); // Position the light far from the planet
        

        // Create GUI
        this.setupGUI();

        // Create the planet first
        this.planet = new Planet(this.scene);
        this.planet.create();

        // Create the player relative to planet
        this.player = new Player(this.scene, this.planet);
        
        // Set initial debug cube visibility to false
        this.player.setDebugCubeVisibility(false);

        // Setup camera
        this.setupCamera();
        
        // Setup debug visuals if needed
        this.setupDebugMode();
        
        // Initialize multiplayer after player is created
        this.setupMultiplayer();

        // Add debug cube toggle handler (P key)
        window.addEventListener('keydown', (ev) => {
            if (ev.key === 'p' || ev.key === 'P') {
                this.player.toggleDebugCube();
            }
        });

        // Simplified mouse movement handler that works in both modes
        this.canvas.addEventListener('mousemove', (event) => {
            let deltaX;
            if (this.isPointerLocked) {
                // Use movementX when in pointer lock mode
                deltaX = event.movementX;
            } else {
                // Fall back to clientX tracking when not in pointer lock
                if (this.lastMouseX === null) {
                    this.lastMouseX = event.clientX;
                    return;
                }
                deltaX = event.clientX - this.lastMouseX;
                this.lastMouseX = event.clientX;
            }
            
            this._mouseMovement = deltaX; // Store the movement for processing in handlePlayerMovement
        });

        // Add mouse click handler for shooting with improved event handling
        this.canvas.addEventListener('mousedown', (event) => {
            event.preventDefault(); // Prevent default browser behavior
            console.log("Mouse down event triggered"); // Debug log
            if (event.button === 0) { // Left mouse button
                this.player.shoot();
            }
        });

        // Set up frag callback
        this.player.setOnFragCallback(() => {
            this.frags++;
        });

        // Add keyboard event listeners if not already added
        if (!this._keyboardInitialized) {
            window.addEventListener('keydown', (event) => {
                // Add the lowercase version of the key to the set
                const key = event.key.toLowerCase();
                this._keysPressed.add(key);
                
                // Handle L key shooting with "tap to shoot" behavior
                if (key === 'l' && !this._lKeyWasPressed) {
                    this._lKeyWasPressed = true; // Mark as pressed so it won't shoot again until released
                    this.player.shoot();
                }
            });

            window.addEventListener('keyup', (event) => {
                const key = event.key.toLowerCase();
                this._keysPressed.delete(key);
                
                // Reset the L key flag when it's released
                if (key === 'l') {
                    this._lKeyWasPressed = false;
                }
            });
            
            this._keyboardInitialized = true;
        }

        // Run the render loop with delta time
        this.engine.runRenderLoop(() => {
            const currentTime = Date.now();
            const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
            this.lastFrameTime = currentTime;

            // Update FPS counter
            this.fpsText.text = `FPS: ${Math.round(this.engine.getFps())}`;
            this.fragsText.text = `Frags: ${this.frags}`;

            this.handlePlayerMovement(deltaTime);
            
            // Update local player
            this.player.update(deltaTime);
            
            // Update all remote players if multiplayer is active
            if (this.multiplayerManager) {
                // Update player data in Firebase
                this.multiplayerManager.updatePlayerData();
                
                // Update all remote players
                this.multiplayerManager.updateRemotePlayers(deltaTime);
            }
            
            this.updateCamera();
            
            this.scene.render();
        });

        // Handle window resize
        window.addEventListener("resize", () => {
            this.engine.resize();
        });

        // Add the skybox to the scene
        this.createSkybox();

        this.scene.environmentIntensity = 0.0; // Set environment/skybox intensity for lighting
        
        // Setup beforeunload handler to clean up multiplayer on page close
        window.addEventListener('beforeunload', () => {
            if (this.multiplayerManager) {
                this.multiplayerManager.dispose();
            }
        });
    }
    
    /**
     * Initializes the multiplayer functionality
     */
    private setupMultiplayer(): void {
        // Create the multiplayer manager
        this.multiplayerManager = new MultiplayerManager(
            this.scene,
            this.player,
            this.planet,
            (playerUUID: string) => {
                // Callback when local player is hit by another player's projectile
                this.frags++; // Increment the frag counter for the other player
                console.log("We were hit by player:", playerUUID);
            }
        );
        
        // Set multiplayer manager reference in player for projectile syncing
        this.player.setMultiplayerManager(this.multiplayerManager);
    }
    
    /**
     * Creates and adds a skybox to the scene.
     */
    private createSkybox(): void {
        // Create a large box for the skybox
        const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        
        // Create a material for the skybox
        const skyboxMaterial = new StandardMaterial("skyBoxMaterial", this.scene);
        
        // Configure material properties for skybox
        skyboxMaterial.backFaceCulling = false; // Render inside of the box
        //skyboxMaterial.disableLighting = true;  // Prevent lighting effects on skybox
        
        // Load the skybox textures for each face using the CubeTexture
        // Standard approach for skyboxes in Babylon.js
        const skyboxTexture = CubeTexture.CreateFromImages([
            "assets/skybox/left.png", 
            "assets/skybox/top.png",   
            "assets/skybox/back.png",    
            "assets/skybox/right.png", 
            "assets/skybox/bottom.png",  
            "assets/skybox/front.png"    
        ], this.scene);
        
        // Apply the skybox texture as a reflection texture
        // This is the standard way to create skyboxes in Babylon.js
        skyboxMaterial.reflectionTexture = skyboxTexture;
        skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
        
        // Disable all other material properties that might interfere with the skybox appearance
        skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
        
        // Apply the material to the skybox
        skybox.material = skyboxMaterial;
        
    }

    /**
     * Sets up debugging visuals to help troubleshoot positioning
     */
    private setupDebugMode(): void {
        // Debug key toggle (D key)
        window.addEventListener('keydown', (ev) => {
            if (ev.key === 'x' || ev.key === 'X') {
                this.debugMode = !this.debugMode;
                this.toggleDebugVisuals();
            }
        });
    }
    
    /**
     * Toggles visibility of debug elements
     */
    private toggleDebugVisuals(): void {
        if (this.debugMode) {
            // Create axes viewer for player
            if (!this.axesViewer) {
                this.axesViewer = new AxesViewer(this.scene, 1); // Size 2
            }
            
            // Create a visible sphere at planet center for reference
            const centerSphere = MeshBuilder.CreateSphere("planetCenter", { diameter: 0.5 }, this.scene);
            centerSphere.position = Vector3.Zero();
            const centerMaterial = new StandardMaterial("centerMaterial", this.scene);
            centerMaterial.diffuseColor = new Color3(1, 1, 0); // Yellow
            centerMaterial.emissiveColor = new Color3(1, 1, 0); // Make it glow
            centerSphere.material = centerMaterial;
        } else {
            // Remove debug visuals
            if (this.axesViewer) {
                this.axesViewer.dispose();
                this.axesViewer = null;
            }
            
            const centerSphere = this.scene.getMeshByName("planetCenter");
            if (centerSphere) {
                centerSphere.dispose();
            }
        }
    }

    /**
     * Updates camera position and orientation based on current mode
     */
    private updateCamera(): void {
        // Update debug axes if enabled
        if (this.debugMode && this.axesViewer) {
            this.axesViewer.update(this.player.getMesh().position, 
                                   this.player.getMesh().forward,
                                   this.player.getMesh().up,
                                   this.player.getMesh().right);
        }
        
        // Always ensure player is visible
        this.player.getMesh().visibility = 1;
        
        if (this.isThirdPersonMode) {
            // Third person camera mode - follows player
            this.updateThirdPersonCamera();
        } else {
            // Planet orbit mode - orbits planet
            this.updateOrbitCamera();
        }
    }
    
    /**
     * Updates camera for third person view (behind player)
     */
    private updateThirdPersonCamera(): void {
        const playerMesh = this.player.getMesh();
        const playerPos = playerMesh.position.clone();
        
        // Calculate up vector (from planet center to player)
        const upVector = playerPos.clone().normalize();
        
        // Get the player's forward direction (positive Z in local space)
        // The front face (blue) is on the positive Z-axis according to standard conventions
        const forwardLocal = new Vector3(0, 0,1); // Fixed: Using Z-axis for forward
        
        // Transform to world space using player's rotation
        const forwardWorld = Vector3.TransformNormal(
            forwardLocal,
            playerMesh.getWorldMatrix()
        ).normalize();
        
        // Ensure forward is perpendicular to up by removing any up component
        const forwardPerp = forwardWorld.subtract(upVector.scale(Vector3.Dot(forwardWorld, upVector))).normalize();
        
        // Calculate right vector
        const rightVector = Vector3.Cross(upVector, forwardPerp).normalize();
        
        // Calculate camera position: behind and above player
        // Subtract forwardPerp to position camera BEHIND the front face (negative Z direction)
        const cameraPos = playerPos.clone()
            .add(upVector.scale(this.thirdPersonHeight))      // Move up
            .subtract(forwardPerp.scale(this.thirdPersonDistance)); // Move back (behind the blue Z-face)
            
        // Smoothly move camera
        this.camera.position = Vector3.Lerp(
            this.camera.position,
            cameraPos,
            this.cameraTransitionSpeed
        );
        
        // Update target: look at player position with slight offset
        const targetOffset = forwardPerp.scale(0.5); // Look slightly ahead of player
        const targetPos = playerPos.add(targetOffset);
        this.camera.target = Vector3.Lerp(
            this.camera.target,
            targetPos,
            this.cameraTransitionSpeed * 2
        );

        // Set the camera's up vector to be the same as the player's up vector (away from planet)
        // This makes the planet appear at the bottom of the screen
        this.camera.upVector = upVector;
    }
    
    /**
     * Updates camera for orbit mode (planet view)
     */
    private updateOrbitCamera(): void {
        // In orbit mode, keep camera at constant height from planet surface
        const planetRadius = this.planet.getBaseRadius();
        const desiredRadius = planetRadius + this.planetOrbitHeight;
        
        // Smoothly transition radius
        this.camera.radius = this.camera.radius + 
            (desiredRadius - this.camera.radius) * this.cameraTransitionSpeed;
        
        // Smoothly transition target back to planet center
        this.camera.target = Vector3.Lerp(
            this.camera.target,
            Vector3.Zero(),
            this.cameraTransitionSpeed
        );
    }

    /**
     * Sets up camera and control keybindings
     */
    private setupCamera(): void {
        // Initialize camera at orbit position
        const planetRadius = this.planet.getBaseRadius();
        this.camera = new ArcRotateCamera(
            "camera",
            0,                  // alpha
            Math.PI / 3,        // beta
            planetRadius + this.planetOrbitHeight, // radius
            Vector3.Zero(),     // target (planet center)
            this.scene
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 5; 
        this.camera.upperRadiusLimit = 30;
        this.camera.minZ = 0.1; // Prevent near-plane clipping
        this.camera.wheelDeltaPercentage = 0.01; // Smoother zooming

        // TODO temp workaround to get the camera scroll working on app start
        this.updateThirdPersonCamera();
        
        // Handle camera mode toggle
        window.addEventListener('keydown', (ev) => {
            if (ev.key === 'c' || ev.key === 'C') {
                this.isThirdPersonMode = !this.isThirdPersonMode;
                
                if (this.isThirdPersonMode) {
                    // Entering third person mode
                    this.camera.detachControl();
                    
                    // Initialize third person camera position
                    this.updateThirdPersonCamera();
                    
                    console.log("Switched to third person mode");
                } else {
                    // Returning to orbit mode
                    this.camera.attachControl(this.canvas, true);
                    console.log("Switched to orbit mode");
                }
            }
        });
    }

    /**
     * Handles player input including both WASD movement, mouse rotation, and spacebar for jetpack
     * @param deltaTime Time elapsed since last frame in seconds
     */
    private handlePlayerMovement(deltaTime: number): void {
        // Process physics regardless of camera mode
        if (this._keysPressed.has(' ')) {
            this.player.activateJetpack();
        } else {
            this.player.deactivateJetpack();
        }

        // Note: L key shooting is now handled in the keydown event listener
        // to ensure each key press fires exactly once
        
        this.player.updatePhysics(deltaTime);
        
        // Update fuel bar
        this.updateFuelBar();

        // Only handle movement in third person mode
        // if (!this.isThirdPersonMode) {
        //     this._mouseMovement = 0; // Reset stored mouse movement
        //     return;
        // }

        // Add keyboard event listeners if not already added
        if (!this._keyboardInitialized) {
            window.addEventListener('keydown', (event) => {
                this._keysPressed.add(event.key.toLowerCase());
            });

            window.addEventListener('keyup', (event) => {
                this._keysPressed.delete(event.key.toLowerCase());
            });
            
            this._keyboardInitialized = true;
        }

        // Process keyboard movement
        if (this._keysPressed.has('a')) this.player.strafeLeft(deltaTime);
        if (this._keysPressed.has('d')) this.player.strafeRight(deltaTime);
        if (this._keysPressed.has('w')) this.player.moveForward(deltaTime);
        if (this._keysPressed.has('s')) this.player.moveBackward(deltaTime);

        // Process mouse rotation if we have movement
        if (this._mouseMovement !== 0) {
            if (this.debugMouseRotation) {
                console.log('Mouse rotate:', {
                    deltaX: this._mouseMovement,
                    rotation: -this._mouseMovement * this.mouseSensitivity,
                });
            }
            this.player.rotate(this._mouseMovement * this.mouseSensitivity);
            this._mouseMovement = 0; // Reset after processing
        }
    }
    
    /**
     * Updates the fuel bar UI based on player's current fuel level
     */
    private updateFuelBar(): void {
        const fuelPercentage = this.player.getFuelPercentage();
        
        // Update the fill width based on fuel percentage
        const fillWidth = (fuelPercentage / 100) * 196; // 196px is the max width
        this.fuelBarFill.width = `${fillWidth}px`;
        
        // Update text
        this.fuelText.text = `Fuel: ${Math.round(fuelPercentage)}%`;
        
        // Change color based on fuel level
        if (fuelPercentage > 66) {
            this.fuelBarFill.background = "#00AAFF"; // Blue for high fuel
        } else if (fuelPercentage > 33) {
            this.fuelBarFill.background = "#FFAA00"; // Orange for medium fuel
        } else {
            this.fuelBarFill.background = "#FF3300"; // Red for low fuel
        }
    }

    /**
     * Sets up GUI elements for FPS, frags counters, and fuel bar
     */
    private setupGUI(): void {
        const advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");

        // Create FPS counter
        this.fpsText = new GUI.TextBlock("fpsText", "FPS: 0");
        this.fpsText.color = "white";
        this.fpsText.fontSize = "24px";
        this.fpsText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.fpsText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        advancedTexture.addControl(this.fpsText);

        // Create frags counter
        this.fragsText = new GUI.TextBlock("fragsText", "Frags: 0");
        this.fragsText.color = "lime"; // Changed to green color
        this.fragsText.fontSize = "24px";
        this.fragsText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT; // Changed to right alignment
        this.fragsText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.fragsText.top = "10px"; // Added some padding from the top
        this.fragsText.left = "-10px"; // Added some padding from the right edge
        advancedTexture.addControl(this.fragsText);
        
        // Create fuel bar background
        this.fuelBar = new GUI.Rectangle("fuelBar");
        this.fuelBar.width = "200px";
        this.fuelBar.height = "20px";
        this.fuelBar.cornerRadius = 5;
        this.fuelBar.color = "white";
        this.fuelBar.thickness = 2;
        this.fuelBar.background = "black";
        this.fuelBar.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.fuelBar.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.fuelBar.top = "10px";
        advancedTexture.addControl(this.fuelBar);
        
        // Create fuel bar fill (progress indicator)
        this.fuelBarFill = new GUI.Rectangle("fuelBarFill");
        this.fuelBarFill.width = "196px"; // Slightly smaller than the background
        this.fuelBarFill.height = "16px";
        this.fuelBarFill.cornerRadius = 4;
        this.fuelBarFill.color = "transparent";
        this.fuelBarFill.background = "#00AAFF"; // Blue color for fuel
        this.fuelBarFill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.fuelBarFill.left = "2px"; // Small padding within container
        this.fuelBar.addControl(this.fuelBarFill);
        
        // Create fuel text
        this.fuelText = new GUI.TextBlock("fuelText", "Fuel: 100%");
        this.fuelText.color = "white";
        this.fuelText.fontSize = "14px";
        this.fuelText.fontWeight = "bold";
        this.fuelText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.fuelText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.fuelBar.addControl(this.fuelText);
    }
}

// Start the game when the page loads
window.addEventListener("DOMContentLoaded", () => {
    new Game();
});