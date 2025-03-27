import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3, Color4, Mesh, MultiMaterial, SubMesh, Matrix, Quaternion, Space, SceneLoader, TransformNode, ParticleSystem, Texture, AbstractMesh } from "@babylonjs/core";
import { Planet } from './Planet';
import { Projectile } from './Projectile';

export class Player {
    private mesh!: Mesh;
    private heightAboveSurface: number = 0.60; // Units above planet surface
    private movementSpeed: number = 1; // Speed of orbital movement
    private astronautModel: TransformNode | null = null; // Container for the astronaut model
    private debugCubeVisible: boolean = false; // New property to control debug cube visibility
    private readonly MAX_HEIGHT: number = 3; // Maximum height limit
    private readonly JETPACK_FORCE: number = 6; // Force of upward movement
    private readonly GRAVITY_FORCE: number = 3; // Force of gravity pulling down
    private verticalVelocity: number = 0; // Current vertical velocity
    private jetpackActive: boolean = false; // Tracks if spacebar is being held
    private jetpackParticles: ParticleSystem | null = null;
    
    // Jetpack fuel system
    private readonly MAX_FUEL: number = 100; // Maximum fuel capacity
    private fuel: number = 80; // Current fuel level (starts full)
    private readonly FUEL_BURN_RATE: number = 16.67; // Units per second (empty in 3 seconds)
    private readonly FUEL_REFILL_RATE: number = 12.67; // Units per second (2x slower than burn rate)
    private hasFuel: boolean = true; // Tracks if there's any fuel left

    private projectiles: Projectile[] = [];
    private onFragCallback: () => void = () => {};
    
    // Unique identifier for this player instance
    private readonly uuid: string;
    
    // Reference to multiplayer manager for projectile registration
    private multiplayerManager: any = null;
    
    // Flag to differentiate between local and remote player
    private isRemotePlayer: boolean = false;

    // Remote player interpolation properties
    private targetPosition: Vector3 | null = null;           // Target position to interpolate toward
    private currentInterpolatedPosition: Vector3 | null = null;  // Current interpolated position
    private previousTargetPosition: Vector3 | null = null;   // Previous target position for velocity estimation
    private targetRotation: Quaternion | null = null;        // Target rotation to interpolate toward
    private currentInterpolatedRotation: Quaternion | null = null; // Current interpolated rotation
    private readonly POSITION_INTERPOLATION_SPEED: number = 15;   // Position units per second (adjusted for smoother movement)
    private readonly ROTATION_INTERPOLATION_SPEED: number = 10;   // Rotation interpolation speed (works well)
    private lastRemotePositionUpdate: number = 0;            // Timestamp of last position update for debugging
    private estimatedVelocity: Vector3 | null = null;        // Estimated velocity for prediction
    private readonly SMOOTHING_FACTOR: number = 0.25;        // Smoothing factor for position (lower = smoother)
    private remoteHeightAboveSurface: number = 0.60;         // Current interpolated height above surface
    private targetHeight: number = 0.60;                     // Target height to interpolate toward
    private previousHeight: number = 0.60;                   // Previous height for velocity calculation
    private estimatedVerticalVelocity: number = 0;          // Estimated vertical velocity
    private readonly HEIGHT_SMOOTHING_FACTOR: number = 0.2;  // Separate smoothing for height changes

    constructor(private scene: Scene, private planet: Planet) {
        // Generate random UUID for this player
        this.uuid = this.generateUUID();
        
        this.createPlayerMesh();
        this.loadAstronautModel();
        this.createJetpackParticles();
    }
    
    /**
     * Generates a random UUID to uniquely identify the player
     * @returns A random UUID string
     */
    private generateUUID(): string {
        // Simple UUID generation function
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    /**
     * Returns the player's UUID
     * @returns The player's unique identifier
     */
    public getUUID(): string {
        return this.uuid;
    }

    getMesh(): Mesh {
        return this.mesh;
    }

    // New method to toggle debug cube visibility
    toggleDebugCube(): void {
        this.debugCubeVisible = !this.debugCubeVisible;
        if (this.mesh.material instanceof MultiMaterial) {
            this.mesh.material.subMaterials.forEach(material => {
                if (material) {
                    material.alpha = this.debugCubeVisible ? 0.5 : 0;
                }
            });
        }
    }

    // New method to set initial debug cube visibility
    setDebugCubeVisibility(visible: boolean): void {
        this.debugCubeVisible = visible;
        if (this.mesh.material instanceof MultiMaterial) {
            this.mesh.material.subMaterials.forEach(material => {
                if (material) {
                    material.alpha = visible ? 0.5 : 0;
                }
            });
        }
    }

    private createPlayerMesh(): void {
        // Create a cube for the player with original size
        this.mesh = MeshBuilder.CreateBox("player", { 
            size: 0.25 // Base size relative to planet radius
        }, this.scene);
        
        // Add player UUID to mesh metadata for collision identification
        this.mesh.metadata = { playerUUID: this.uuid };

        // Create separate materials for front and bottom faces
        const frontMaterial = new StandardMaterial("frontMaterial", this.scene);
        frontMaterial.diffuseColor = new Color3(0, 0, 1); // Blue for front (Z-axis)
        
        const bottomMaterial = new StandardMaterial("bottomMaterial", this.scene);
        bottomMaterial.diffuseColor = new Color3(0, 1, 0); // Green for bottom (Y-axis)
        
        const defaultMaterial = new StandardMaterial("defaultMaterial", this.scene);
        defaultMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5); // Gray for other sides

        // Set materials to be translucent
        frontMaterial.alpha = 0.5; // 50% transparency for front face
        bottomMaterial.alpha = 0.5; // 50% transparency for bottom face
        defaultMaterial.alpha = 0.5; // 50% transparency for other sides

        // Apply materials to specific faces using submeshes
        const multiMat = new MultiMaterial("multi", this.scene);
        multiMat.subMaterials.push(defaultMaterial); // 0: default
        multiMat.subMaterials.push(frontMaterial);   // 1: front (Z-axis face)
        multiMat.subMaterials.push(bottomMaterial);  // 2: bottom (Y-axis face)

        this.mesh.material = multiMat;
        
        // Define vertices for each face to create submeshes
        this.mesh.subMeshes = [];
        
        // All faces except front and bottom (default gray)
        this.mesh.subMeshes.push(new SubMesh(0, 0, this.mesh.getTotalVertices(), 0, 12, this.mesh));  // left and right
        this.mesh.subMeshes.push(new SubMesh(0, 0, this.mesh.getTotalVertices(), 12, 6, this.mesh));  // back (negative Z)
        this.mesh.subMeshes.push(new SubMesh(0, 0, this.mesh.getTotalVertices(), 24, 6, this.mesh));  // top
        
        // Front face (blue, positive Z)
        this.mesh.subMeshes.push(new SubMesh(1, 0, this.mesh.getTotalVertices(), 18, 6, this.mesh));
        
        // Bottom face (green, negative Y)
        this.mesh.subMeshes.push(new SubMesh(2, 0, this.mesh.getTotalVertices(), 30, 6, this.mesh));

        // Position the player near the planet surface
        this.spawnRandomPosition();
    }

    private spawnRandomPosition(): void {
        // Generate a random position on the sphere
        const phi = Math.random() * Math.PI * 2; // Random angle around Y axis
        const theta = Math.random() * Math.PI; // Random angle from Y axis
        
        // Convert spherical coordinates to cartesian
        const planetRadius = this.planet.getBaseRadius();
        const spawnRadius = planetRadius + this.heightAboveSurface;
        
        const x = spawnRadius * Math.sin(theta) * Math.cos(phi);
        const y = spawnRadius * Math.cos(theta);
        const z = spawnRadius * Math.sin(theta) * Math.sin(phi);
        
        this.mesh.position = new Vector3(x, y, z);

        // Apply visual scale
        this.mesh.scaling = new Vector3(1.5, 1.5, 1.5);

        // Orient the player to stand on the planet surface
        // Calculate direction from planet center to player (this will be our up vector)
        const toPlanetCenter = Vector3.Zero().subtract(this.mesh.position).normalize();
        
        // Since we want the bottom face (Y) pointing towards the planet:
        // - Set localUp as negative toPlanetCenter (points away from planet)
        const localUp = toPlanetCenter.scale(-1);
        
        // For forward direction (Z-axis, blue face), choose any direction perpendicular to up
        // We'll use a random initial forward direction that's perpendicular to up
        let localForward = Vector3.Forward(); // Start with world forward
        // Remove any component parallel to up to make it perpendicular
        localForward = localForward.subtract(localUp.scale(Vector3.Dot(localForward, localUp))).normalize();
        
        // If forward ended up too close to up, use a different initial direction
        if (localForward.length() < 0.1) {
            localForward = Vector3.Right();
            localForward = localForward.subtract(localUp.scale(Vector3.Dot(localForward, localUp))).normalize();
        }
        
        // Calculate right vector to complete orthonormal basis
        const localRight = Vector3.Cross(localUp, localForward).normalize();
        
        // Create rotation matrix from our orthonormal basis
        // Important: Order is XYZ where:
        // - X is right (for proper strafing)
        // - Y is up (for proper planet orientation)
        // - Z is forward (blue face, for proper camera positioning)
        const rotationMatrix = Matrix.Zero();
        Matrix.FromXYZAxesToRef(
            localRight,      // Right vector defines cube's local X
            localUp,         // Up vector defines cube's local Y
            localForward,    // Forward vector defines cube's local Z (blue face)
            rotationMatrix
        );

        // Apply the rotation
        this.mesh.rotationQuaternion = Quaternion.FromRotationMatrix(rotationMatrix);

    }

    private loadAstronautModel(): void {
        // Load the astronaut model using relative path that matches webpack's asset serving
        SceneLoader.ImportMeshAsync(
            "", // meshName (empty string means import all meshes)
            "assets/3d/", // relative path without leading slash
            "fragnaut1.glb",
            this.scene
        ).then((result) => {
            if (result.meshes.length > 0) {
                this.astronautModel = result.meshes[0];
                
                // Parent the model to our player cube
                this.astronautModel.parent = this.mesh;


                // Reset the model's position relative to the parent
                this.astronautModel.position = Vector3.Zero();
                this.astronautModel.rotationQuaternion = null;
                this.astronautModel.rotation = Vector3.Zero();
                
                // Scale the model to fit inside the cube
                this.astronautModel.scaling = new Vector3(0.1, 0.1, 0.1);
                
                console.log("Successfully loaded astronaut model");
            } else {
                console.error("Astronaut model loaded but no meshes found");
            }
        }).catch(error => {
            // More detailed error logging
            console.error("Failed to load astronaut model:", error);
            console.error("Attempted to load from: assets/3d/fragnaut1.glb");
        });
    }

    /**
     * Creates the particle system for jetpack effect
     */
    private createJetpackParticles(): void {
        // Create particle system
        this.jetpackParticles = new ParticleSystem("jetpackParticles", 300, this.scene);
        
        // Set particle texture using the data URL
        this.jetpackParticles.particleTexture = new Texture("assets/textures/flare.png");
        
        // Particle emission properties
        this.jetpackParticles.minEmitBox = new Vector3(-0.02, -0.02, 0); // Smaller emission box
        this.jetpackParticles.maxEmitBox = new Vector3(0.02, 0.02, 0);
        
        // Particle appearance
        this.jetpackParticles.color1 = new Color4(0.2, 0.4, 1.0, 1.0); // Bright orange/yellow
        this.jetpackParticles.color2 = new Color4(0.3, 0.5, 1.0, 0.8); // Slightly transparent red
        this.jetpackParticles.colorDead = new Color4(0.3, 0.5, 1.0, 0.0); // Fade to transparent dark orange
        
        // Particle behavior
        this.jetpackParticles.minSize = 0.1; // Increased minimum size
        this.jetpackParticles.maxSize = 0.25; // Increased maximum size
        this.jetpackParticles.minLifeTime = 0.1;
        this.jetpackParticles.maxLifeTime = 0.2;
        this.jetpackParticles.emitRate = 300; // Increased emit rate
        
        // Particle movement
        this.jetpackParticles.direction1 = new Vector3(-0.1, 0, 1); // Slight spread
        this.jetpackParticles.direction2 = new Vector3(0.1, 0, 1);
        this.jetpackParticles.minEmitPower = 2; // Increased emission power
        this.jetpackParticles.maxEmitPower = 3;
        this.jetpackParticles.updateSpeed = 0.01;
        
        // Add gravity effect to make particles fall slightly
        this.jetpackParticles.gravity = new Vector3(0, -1, 0);
        
        // Enable billboard mode so particles always face camera
        this.jetpackParticles.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
        
        // Enable blending for better visual effect
        this.jetpackParticles.blendMode = ParticleSystem.BLENDMODE_ADD;
        
        // Start with particles stopped
        this.jetpackParticles.stop();
    }

    /**
     * Updates the particle system position and rotation to match player orientation
     */
    private updateParticleSystem(): void {
        if (!this.jetpackParticles || !this.mesh) return;

        // Position particles at the back of the player mesh
        const backOffset = this.mesh.forward.scale(-0.1); // Small offset behind player
        const particlePos = this.mesh.position.add(backOffset);
        
        // Update emitter position and rotation
        this.jetpackParticles.emitter = particlePos;
        
        // Calculate emission direction based on player's orientation
        // We want particles to emit in the opposite direction of player's forward vector
        const emitDir = this.mesh.forward.scale(-1);
        this.jetpackParticles.direction1 = emitDir;
        this.jetpackParticles.direction2 = emitDir;
    }

    /**
     * Moves the player along a local axis while maintaining orbit
     * @param deltaTime Time since last frame for smooth movement
     */
    public strafeLeft(deltaTime: number): void {
        // Skip movement for remote players
        if (this.isRemotePlayer) return;
        
        // Move left using negative X axis (right vector)
        this.moveAlongOrbit(this.mesh.right.scale(-1), deltaTime);
    }

    public strafeRight(deltaTime: number): void {
        // Skip movement for remote players
        if (this.isRemotePlayer) return;
        
        // Move right using positive X axis (right vector)
        this.moveAlongOrbit(this.mesh.right, deltaTime);
    }

    public moveForward(deltaTime: number): void {
        // Skip movement for remote players
        if (this.isRemotePlayer) return;
        
        // Move forward using positive Z axis (forward vector)
        this.moveAlongOrbit(this.mesh.forward, deltaTime);
    }

    public moveBackward(deltaTime: number): void {
        // Skip movement for remote players
        if (this.isRemotePlayer) return;
        
        // Move backward using negative Z axis (forward vector)
        this.moveAlongOrbit(this.mesh.forward.scale(-1), deltaTime);
    }


    /**
     * Moves the player along the orbital path while maintaining orientation
     * @param crossAxis The player's local axis to determine orbit direction (right for strafe, forward for forward/back)
     * @param deltaTime Time since last frame for smooth movement
     */
    private moveAlongOrbit(crossAxis: Vector3, deltaTime: number): void {
        // Get normalized direction from player to planet center (this will be our reference for up)
        const toPlanetCenter = Vector3.Zero().subtract(this.mesh.position).normalize();

        // Calculate the orbital movement direction by crossing the input axis with toPlanetCenter
        // This ensures movement is always tangent to the planet surface
        const orbitDirection = Vector3.Cross(crossAxis, toPlanetCenter).normalize();
        
        // Calculate angle to rotate based on movement speed and delta time
        const angle = this.movementSpeed * deltaTime;
        
        // Create rotation matrix around orbitDirection
        const rotationMatrix = Matrix.RotationAxis(orbitDirection, angle);
        
        // Apply rotation to position while maintaining distance from planet
        const planetRadius = this.planet.getBaseRadius();
        const orbitRadius = planetRadius + this.heightAboveSurface;
        
        // Transform position and normalize to maintain orbit radius
        const newPosition = Vector3.TransformCoordinates(this.mesh.position, rotationMatrix);
        this.mesh.position = newPosition.normalize().scale(orbitRadius);
        
        // Keep the player's current orientation (don't rotate the mesh itself)
        // This ensures the blue face (Z) and green face (Y) stay properly oriented
        // We only need to adjust the up vector to point away from planet
        
        const localUp = toPlanetCenter.scale(-1); // Up points away from planet
        const localForward = this.mesh.forward;   // Maintain current forward direction
        const localRight = Vector3.Cross(localUp, localForward).normalize();
        
        // Recompute forward to ensure it's perpendicular to up
        const correctedForward = Vector3.Cross(localRight, localUp).normalize();
        
        // Create and apply rotation matrix from orthonormal basis
        const orientationMatrix = Matrix.Zero();
        Matrix.FromXYZAxesToRef(localRight, localUp, correctedForward, orientationMatrix);
        this.mesh.rotationQuaternion = Quaternion.FromRotationMatrix(orientationMatrix);
    }

    /**
     * Rotates the player around their up axis (y-axis in local space)
     * @param deltaRadians Amount to rotate in radians
     */
    public rotate(deltaRadians: number): void {
        // Skip rotation for remote players
        if (this.isRemotePlayer) return;
        
        // Get current up vector (away from planet center)
        const toPlanetCenter = Vector3.Zero().subtract(this.mesh.position).normalize();
        const localUp = toPlanetCenter.scale(-1);

        // Create rotation matrix around the up vector
        const rotationMatrix = Matrix.RotationAxis(localUp, deltaRadians);
        
        // Get current orientation vectors
        const currentForward = this.mesh.forward;
        const currentRight = this.mesh.right;
        
        // Apply rotation to forward and right vectors
        const newForward = Vector3.TransformNormal(currentForward, rotationMatrix);
        const newRight = Vector3.TransformNormal(currentRight, rotationMatrix);
        
        // Create new orientation matrix from rotated vectors
        const orientationMatrix = Matrix.Zero();
        Matrix.FromXYZAxesToRef(newRight, localUp, newForward, orientationMatrix);
        
        // Apply new orientation
        this.mesh.rotationQuaternion = Quaternion.FromRotationMatrix(orientationMatrix);

    }

    /**
     * Updates the player's vertical position based on physics
     * @param deltaTime Time since last frame for smooth movement
     */
    public updatePhysics(deltaTime: number): void {
        // Skip physics for remote players
        if (this.isRemotePlayer) {
            // Instead, handle interpolation for remote players
            this.updateRemoteInterpolation(deltaTime);
            return;
        }
        
        // Calculate the direction away from planet center (up vector)
        const toPlanetCenter = Vector3.Zero().subtract(this.mesh.position).normalize();
        const upVector = toPlanetCenter.scale(-1);

        // Update fuel levels
        this.updateFuel(deltaTime);

        // Apply jetpack force if active and has fuel
        if (this.jetpackActive && this.hasFuel && this.heightAboveSurface < this.MAX_HEIGHT) {
            this.verticalVelocity += this.JETPACK_FORCE * deltaTime;
        }

        // Apply gravity
        this.verticalVelocity -= this.GRAVITY_FORCE * deltaTime;

        // Update height
        this.heightAboveSurface += this.verticalVelocity * deltaTime;

        // Clamp height between surface level and max height
        if (this.heightAboveSurface < 0.60) {
            this.heightAboveSurface = 0.60;
            this.verticalVelocity = 0; // Stop vertical movement at surface
        } else if (this.heightAboveSurface > this.MAX_HEIGHT) {
            this.heightAboveSurface = this.MAX_HEIGHT;
            this.verticalVelocity = 0; // Stop vertical movement at max height
        }

        // Update position
        const planetRadius = this.planet.getBaseRadius();
        const newDistance = planetRadius + this.heightAboveSurface;
        this.mesh.position = this.mesh.position.normalize().scale(newDistance);

        // Update particle system position and direction
        this.updateParticleSystem();

        // Update projectiles
        this.projectiles = this.projectiles.filter(projectile => projectile.update());
    }

    /**
     * Updates interpolation for remote players to smooth out network updates
     * @param deltaTime Time since last frame for smooth interpolation
     */
    private updateRemoteInterpolation(deltaTime: number): void {
        // Skip if we don't have target positions/rotations yet
        if (!this.targetPosition) return;
        
        // Initialize interpolation values if needed
        if (!this.currentInterpolatedPosition) {
            this.currentInterpolatedPosition = this.mesh.position.clone();
        }
        if (this.targetRotation && !this.currentInterpolatedRotation) {
            this.currentInterpolatedRotation = this.mesh.rotationQuaternion ? 
                this.mesh.rotationQuaternion.clone() : Quaternion.Identity();
        }
        
        // Interpolate height with velocity prediction
        const heightDiff = this.targetHeight - this.remoteHeightAboveSurface;
        if (Math.abs(heightDiff) > 0.001) {
            // Use HEIGHT_SMOOTHING_FACTOR for smoother vertical movement
            const heightDelta = heightDiff * this.HEIGHT_SMOOTHING_FACTOR;
            
            // Add velocity prediction for smoother movement
            const predictedHeight = heightDelta + (this.estimatedVerticalVelocity * deltaTime * 0.5);
            
            // Update the interpolated height
            this.remoteHeightAboveSurface += predictedHeight;
            
            // Clamp height between valid ranges
            this.remoteHeightAboveSurface = Math.max(0.60, Math.min(this.remoteHeightAboveSurface, 3));
        }
        
        // Calculate max distance to move this frame
        const maxPositionDelta = this.POSITION_INTERPOLATION_SPEED * deltaTime;
        
        // Calculate direction and distance to target
        const toTarget = this.targetPosition.subtract(this.currentInterpolatedPosition);
        const distanceToTarget = toTarget.length();
        
        // Use velocity-based prediction for smoother movement
        if (distanceToTarget > 0.0001) {
            // Apply smoothing factor for natural movement
            const smoothingAmount = Math.min(1.0, this.SMOOTHING_FACTOR);
            let moveVector = toTarget.scale(smoothingAmount);
            
            // Add velocity prediction
            if (this.estimatedVelocity && this.estimatedVelocity.length() > 0.001) {
                const velocityFactor = 0.2;
                moveVector.addInPlace(this.estimatedVelocity.scale(velocityFactor));
            }
            
            // Limit movement speed
            if (moveVector.length() > maxPositionDelta) {
                moveVector = moveVector.normalize().scale(maxPositionDelta);
            }
            
            // Apply movement
            this.currentInterpolatedPosition.addInPlace(moveVector);
            
            // Update position while maintaining correct height
            const planetRadius = this.planet.getBaseRadius();
            const targetDistance = planetRadius + this.remoteHeightAboveSurface;
            this.currentInterpolatedPosition = this.currentInterpolatedPosition.normalize().scale(targetDistance);
            
            // Apply final position
            this.mesh.position = this.currentInterpolatedPosition.clone();
        }
        
        // Handle rotation interpolation
        if (this.currentInterpolatedRotation && this.targetRotation) {
            const rotationFactor = Math.min(this.ROTATION_INTERPOLATION_SPEED * deltaTime, 1);
            Quaternion.SlerpToRef(
                this.currentInterpolatedRotation,
                this.targetRotation,
                rotationFactor,
                this.currentInterpolatedRotation
            );
            this.mesh.rotationQuaternion = this.currentInterpolatedRotation.clone();
        }
        
        // Update particle system
        this.updateParticleSystem();
    }

    /**
     * Updates fuel level based on jetpack usage
     * @param deltaTime Time since last frame for smooth fuel changes
     */
    private updateFuel(deltaTime: number): void {
        if (this.jetpackActive) {
            // Reduce fuel when jetpack is active
            this.fuel -= this.FUEL_BURN_RATE * deltaTime;
            if (this.fuel <= 0) {
                this.fuel = 0;
                this.hasFuel = false;
                // Automatically turn off particles when out of fuel
                if (this.jetpackParticles && this.jetpackParticles.isStarted()) {
                    this.jetpackParticles.stop();
                }
            }
        } else {
            // Refill fuel when jetpack is not active
            this.fuel += this.FUEL_REFILL_RATE * deltaTime;
            if (this.fuel > this.MAX_FUEL) {
                this.fuel = this.MAX_FUEL;
            }
            // Restore thrust capability when fuel reaches 10%
            if (!this.hasFuel && this.fuel >= this.MAX_FUEL * 0.1) {
                this.hasFuel = true;
            }
        }
    }

    /**
     * Returns whether the jetpack is currently active
     */
    public isJetpackActive(): boolean {
        return this.jetpackActive;
    }

    /**
     * Activates the jetpack (called when spacebar is pressed)
     */
    public activateJetpack(): void {
        this.jetpackActive = true;
        // Start particle effect only if we have fuel
        if (this.hasFuel && this.jetpackParticles && !this.jetpackParticles.isStarted()) {
            this.jetpackParticles.start();
        }
    }

    /**
     * Deactivates the jetpack (called when spacebar is released)
     */
    public deactivateJetpack(): void {
        this.jetpackActive = false;
        // Stop particle effect
        if (this.jetpackParticles && this.jetpackParticles.isStarted()) {
            this.jetpackParticles.stop();
        }
    }

    /**
     * Returns the current fuel percentage (0-100)
     */
    public getFuelPercentage(): number {
        return (this.fuel / this.MAX_FUEL) * 100;
    }

    /**
     * Shoots a projectile and registers it with the multiplayer manager if available
     */
    public shoot(): void {
        // Don't allow remote players to shoot
        if (this.isRemotePlayer) return;
        
        // Calculate spawn position slightly in front of player
        const spawnPosition = this.mesh.position.add(this.mesh.forward.scale(0.5));
        
        // Create projectile
        const projectile = new Projectile(
            this.scene,
            spawnPosition,
            this.mesh.forward,
            this.mesh.scaling.x,
            (target: AbstractMesh) => {
                // Handle hit
                // Check if the target is a player mesh
                if (target.name === "player") {
                    // Get player UUID from metadata to check if it's a remote player
                    const metadata = target.metadata;
                    if (metadata && metadata.playerUUID !== this.uuid) {
                        this.onFragCallback();
                    }
                }
            },
            this.uuid // Pass the player's UUID to the projectile
        );
        
        // Add to local projectiles array
        this.projectiles.push(projectile);
        
        // Register with multiplayer manager if available
        if (this.multiplayerManager) {
            this.multiplayerManager.addProjectile(projectile, spawnPosition, this.mesh.forward);
        }
    }

    /**
     * Sets the reference to the multiplayer manager
     */
    public setMultiplayerManager(manager: any): void {
        this.multiplayerManager = manager;
    }

    /**
     * Marks this player as a remote player (controlled by another client)
     */
    public setAsRemotePlayer(): void {
        this.isRemotePlayer = true;
    }

    /**
     * Updates the position of a remote player from network data
     */
    public setRemotePosition(position: Vector3): void {
        if (!this.isRemotePlayer) return;
        
        // Track position updates for debugging
        const timeSinceLastUpdate = Date.now() - this.lastRemotePositionUpdate;
        this.lastRemotePositionUpdate = Date.now();
        
        // Extract height above planet surface from the position
        const planetRadius = this.planet.getBaseRadius();
        const positionMagnitude = position.length();
        
        // Store previous height for velocity calculation
        this.previousHeight = this.targetHeight;
        this.targetHeight = positionMagnitude - planetRadius;
        
        // Calculate vertical velocity for smoother height transitions
        if (this.previousHeight !== this.targetHeight) {
            const heightDelta = this.targetHeight - this.previousHeight;
            const timeDelta = Math.max(0.016, timeSinceLastUpdate / 1000); // Convert to seconds, minimum 16ms
            this.estimatedVerticalVelocity = heightDelta / timeDelta;
        }
        
        // If we have a previous target position, calculate velocity
        if (this.targetPosition && this.previousTargetPosition) {
            // Calculate the velocity based on movement between last two positions
            const velocity = this.targetPosition.subtract(this.previousTargetPosition);
            
            // Only update velocity estimate if the positions are different enough to avoid jitter
            if (velocity.length() > 0.001) {
                if (!this.estimatedVelocity) {
                    this.estimatedVelocity = velocity.clone();
                } else {
                    // Smooth velocity changes to prevent jerky movement
                    this.estimatedVelocity = this.estimatedVelocity.scale(0.7).add(velocity.scale(0.3));
                }
            }
        }
        
        // Store previous target for velocity calculations
        this.previousTargetPosition = this.targetPosition ? this.targetPosition.clone() : null;
        
        // Set new target position for interpolation
        this.targetPosition = position.clone();
        
        // Initialize current position if this is the first update
        if (!this.currentInterpolatedPosition) {
            this.currentInterpolatedPosition = this.mesh.position.clone();
            this.remoteHeightAboveSurface = this.targetHeight;
            console.log("Initialized remote player position interpolation");
        }
    }

    /**
     * Updates the rotation of a remote player from network data
     */
    public setRemoteRotation(rotation: {x: number, y: number, z: number, w: number}): void {
        if (!this.isRemotePlayer) return;
        
        // Create quaternion from received data
        const newRotation = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
        
        // Set as target for interpolation
        this.targetRotation = newRotation;
        
        // Initialize current rotation if this is the first update
        if (!this.currentInterpolatedRotation) {
            this.currentInterpolatedRotation = this.mesh.rotationQuaternion ? 
                this.mesh.rotationQuaternion.clone() : newRotation.clone();
            console.log("Initialized remote player rotation interpolation");
        }
    }

    /**
     * Respawns the player at a random position on the planet
     */
    public respawn(): void {
        // Reset velocity
        this.verticalVelocity = 0;
        
        // Reset height
        this.heightAboveSurface = 0.60;
        
        // Generate new random position
        this.spawnRandomPosition();
        
        // Reset fuel to 50%
        this.fuel = this.MAX_FUEL * 0.5;
        this.hasFuel = true;
        
        // Deactivate jetpack
        this.deactivateJetpack();
    }

    /**
     * Cleans up resources when player is removed
     */
    public dispose(): void {
        // Dispose of meshes
        if (this.mesh) {
            this.mesh.dispose();
        }
        
        // Dispose of astronaut model
        if (this.astronautModel) {
            this.astronautModel.dispose();
        }
        
        // Dispose of particles
        if (this.jetpackParticles) {
            this.jetpackParticles.dispose();
        }
        
        // Dispose of all projectiles
        this.projectiles.forEach(projectile => projectile.dispose());
        this.projectiles = [];
    }

    public setOnFragCallback(callback: () => void): void {
        this.onFragCallback = callback;
    }

    /**
     * Executes an update tick for this player
     * @param deltaTime Time since last frame for smooth movement
     * @returns void
     */
    public update(deltaTime: number): void {
        // Update physics or interpolation based on player type
        if (this.isRemotePlayer) {
            this.updateRemoteInterpolation(deltaTime);
        } else {
            this.updatePhysics(deltaTime);
        }
        
        // Update projectiles for all player types
        this.projectiles = this.projectiles.filter(projectile => projectile.update());
        
        // Update particle system position for all player types
        this.updateParticleSystem();
    }
}