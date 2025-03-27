import { ref, onValue, set, push, remove, onDisconnect, update, DataSnapshot } from 'firebase/database';
import { database } from './firebase.config';
import { Scene, Vector3, ParticleSystem, Texture, Color4, AbstractMesh } from '@babylonjs/core';
import { Player } from './Player';
import { Planet } from './Planet';
import { Projectile } from './Projectile';

// Types to define data structure in Firebase
interface PlayerData {
    position: { x: number, y: number, z: number };
    rotation: { x: number, y: number, z: number, w: number };
    isJetpackActive: boolean;
    lastUpdate: number;
}

interface ProjectileData {
    id: string;
    position: { x: number, y: number, z: number };
    direction: { x: number, y: number, z: number };
    ownerUUID: string;
    createdAt: number;
}

interface DeathEffectData {
    id: string;
    position: { x: number, y: number, z: number };
    createdAt: number;
}

export class MultiplayerManager {
    private playersRef = ref(database, 'players');
    private projectilesRef = ref(database, 'projectiles');
    private deathEffectsRef = ref(database, 'deathEffects');
    private playerUUID: string;
    private isHost: boolean = false;
    private otherPlayers: Map<string, Player> = new Map();
    private otherProjectiles: Map<string, Projectile> = new Map();
    private deathEffects: Map<string, ParticleSystem> = new Map();
    private updateInterval: number = 33; // Changed from 50ms to 33ms (30 FPS) for smoother updates
    private lastUpdateTime: number = 0;
    private cleanupTimer: number = 0;
    
    constructor(
        private scene: Scene,
        private localPlayer: Player,
        private planet: Planet,
        private onOtherPlayerHit: (playerUUID: string) => void
    ) {
        this.playerUUID = this.localPlayer.getUUID();
        
        // Listen for other players
        this.setupPlayerListeners();
        
        // Listen for projectiles
        this.setupProjectileListeners();
        
        // Listen for death effects
        this.setupDeathEffectListeners();
        
        // Set cleanup timer for stale data
        this.cleanupTimer = window.setInterval(() => this.cleanupStaleData(), 10000);
        
        // Register our player and handle disconnect
        this.registerPlayer();
        
        console.log("Multiplayer manager initialized with UUID:", this.playerUUID);
    }
    
    /**
     * Registers the local player to Firebase and sets up disconnect handler
     */
    private registerPlayer(): void {
        const playerRef = ref(database, `players/${this.playerUUID}`);
        
        // Set initial player data
        this.updatePlayerData();
        
        // Set up disconnect handler to remove player when they leave
        onDisconnect(playerRef).remove();
    }
    
    /**
     * Sets up listeners for other players joining and leaving
     */
    private setupPlayerListeners(): void {
        onValue(this.playersRef, (snapshot) => {
            if (!snapshot.exists()) return;
            
            const players = snapshot.val();
            const currentTime = Date.now();
            
            // Process each player in the database
            Object.entries(players).forEach(([uuid, playerData]: [string, any]) => {
                // Skip our own player
                if (uuid === this.playerUUID) return;
                
                // Check if player data is stale (more than 10 seconds old)
                if (currentTime - playerData.lastUpdate > 10000) {
                    console.log("Skipping stale player data:", uuid);
                    return;
                }
                
                // Create or update other player
                if (!this.otherPlayers.has(uuid)) {
                    // Create new remote player
                    console.log("New player joined:", uuid);
                    const remotePlayer = new Player(this.scene, this.planet);
                    remotePlayer.setDebugCubeVisibility(false);
                    remotePlayer.setAsRemotePlayer();
                    this.otherPlayers.set(uuid, remotePlayer);
                }
                
                // Update remote player position and state
                const remotePlayer = this.otherPlayers.get(uuid)!;
                this.updateRemotePlayer(remotePlayer, playerData);
            });
            
            // Check for players that have left
            this.otherPlayers.forEach((player, uuid) => {
                if (!players[uuid]) {
                    console.log("Player left:", uuid);
                    player.dispose();
                    this.otherPlayers.delete(uuid);
                }
            });
        });
    }
    
    /**
     * Sets up listeners for projectiles
     */
    private setupProjectileListeners(): void {
        onValue(this.projectilesRef, (snapshot) => {
            if (!snapshot.exists()) return;
            
            const projectiles = snapshot.val();
            const currentTime = Date.now();
            
            // Process each projectile in the database
            Object.entries(projectiles).forEach(([id, projData]: [string, any]) => {
                // Skip projectiles that we own
                if (projData.ownerUUID === this.playerUUID) return;
                
                // Skip projectiles that are too old (more than 2 seconds)
                if (currentTime - projData.createdAt > 2000) return;
                
                // Create new remote projectile if we don't have it already
                if (!this.otherProjectiles.has(id)) {
                    const position = new Vector3(
                        projData.position.x,
                        projData.position.y,
                        projData.position.z
                    );
                    
                    const direction = new Vector3(
                        projData.direction.x,
                        projData.direction.y,
                        projData.direction.z
                    );
                    
                    // Create the projectile
                    const proj = new Projectile(
                        this.scene,
                        position,
                        direction,
                        1.5, // Use standard player scale
                        (target: AbstractMesh) => {
                            // Check if hit was on our local player
                            if (target === this.localPlayer.getMesh()) {
                                console.log("We were hit by a projectile from:", projData.ownerUUID);
                                
                                // Create death effect at our position
                                this.createDeathEffect(this.localPlayer.getMesh().position.clone());
                                
                                // Notify game that we were hit
                                this.onOtherPlayerHit(projData.ownerUUID);
                                
                                // Our local player should respawn
                                this.localPlayer.respawn();
                            }
                        },
                        projData.ownerUUID
                    );
                    
                    this.otherProjectiles.set(id, proj);
                }
            });
            
            // Check for projectiles that are no longer in the database
            this.otherProjectiles.forEach((proj, id) => {
                if (!projectiles[id]) {
                    proj.dispose();
                    this.otherProjectiles.delete(id);
                }
            });
        });
    }
    
    /**
     * Sets up listeners for death effects
     */
    private setupDeathEffectListeners(): void {
        onValue(this.deathEffectsRef, (snapshot) => {
            if (!snapshot.exists()) return;
            
            const effects = snapshot.val();
            const currentTime = Date.now();
            
            // Process each death effect in the database
            Object.entries(effects).forEach(([id, effectData]: [string, any]) => {
                // Skip effects that are too old (more than 3 seconds)
                if (currentTime - effectData.createdAt > 3000) return;
                
                // Create new effect if we don't have it already
                if (!this.deathEffects.has(id)) {
                    const position = new Vector3(
                        effectData.position.x,
                        effectData.position.y,
                        effectData.position.z
                    );
                    
                    // Create the death effect particle system
                    this.createDeathEffectParticles(id, position);
                }
            });
        });
    }
    
    /**
     * Updates the local player's data in Firebase
     */
    public updatePlayerData(): void {
        const currentTime = Date.now();
        
        // Use a shorter update interval for more frequent position updates
        // This gives remote players more position data points for smoother interpolation
        if (currentTime - this.lastUpdateTime < this.updateInterval) return;
        
        this.lastUpdateTime = currentTime;
        
        const playerMesh = this.localPlayer.getMesh();
        const playerRef = ref(database, `players/${this.playerUUID}`);
        
        // Ensure rotation quaternion exists
        if (!playerMesh.rotationQuaternion) {
            console.error("Player mesh missing rotation quaternion!");
            return;
        }
        
        // Prepare player data for Firebase
        const playerData: PlayerData = {
            position: {
                x: playerMesh.position.x,
                y: playerMesh.position.y,
                z: playerMesh.position.z
            },
            rotation: {
                x: playerMesh.rotationQuaternion.x,
                y: playerMesh.rotationQuaternion.y,
                z: playerMesh.rotationQuaternion.z,
                w: playerMesh.rotationQuaternion.w
            },
            isJetpackActive: this.localPlayer.isJetpackActive(),
            lastUpdate: currentTime
        };
        
        // Update Firebase with our latest position and rotation
        set(playerRef, playerData);
    }
    
    /**
     * Adds a projectile to Firebase
     */
    public addProjectile(projectile: Projectile, position: Vector3, direction: Vector3): string {
        // Create a new unique ID for this projectile
        const newProjectileRef = push(this.projectilesRef);
        const projectileId = newProjectileRef.key!;
        
        // Prepare projectile data
        const projectileData: ProjectileData = {
            id: projectileId,
            position: {
                x: position.x,
                y: position.y,
                z: position.z
            },
            direction: {
                x: direction.x,
                y: direction.y,
                z: direction.z
            },
            ownerUUID: this.playerUUID,
            createdAt: Date.now()
        };
        
        // Add to Firebase
        set(newProjectileRef, projectileData);
        
        // Set up auto-removal after 2 seconds
        setTimeout(() => {
            remove(ref(database, `projectiles/${projectileId}`));
        }, 2000);
        
        return projectileId;
    }
    
    /**
     * Creates a death effect at the given position and syncs to Firebase
     */
    public createDeathEffect(position: Vector3): void {
        // Create a new unique ID for this effect
        const newEffectRef = push(this.deathEffectsRef);
        const effectId = newEffectRef.key!;
        
        // Prepare effect data
        const effectData: DeathEffectData = {
            id: effectId,
            position: {
                x: position.x,
                y: position.y,
                z: position.z
            },
            createdAt: Date.now()
        };
        
        // Add to Firebase
        set(newEffectRef, effectData);
        
        // Create local effect
        this.createDeathEffectParticles(effectId, position);
        
        // Set up auto-removal after 3 seconds
        setTimeout(() => {
            remove(ref(database, `deathEffects/${effectId}`));
        }, 3000);
    }
    
    /**
     * Creates a death effect particle system
     */
    private createDeathEffectParticles(id: string, position: Vector3): void {
        // Create particle system
        const particles = new ParticleSystem(`deathEffect_${id}`, 200, this.scene);
        particles.particleTexture = new Texture("assets/textures/flare.png", this.scene);
        
        // Set emitter at death position
        particles.emitter = position;
        
        // Configure appearance
        particles.color1 = new Color4(1, 0.5, 0, 1); // Orange
        particles.color2 = new Color4(1, 0.1, 0, 0.8); // Red
        particles.colorDead = new Color4(0.2, 0.1, 0, 0); // Fade out
        
        // Configure size and lifetime
        particles.minSize = 0.2;
        particles.maxSize = 0.5;
        particles.minLifeTime = 0.5;
        particles.maxLifeTime = 1.5;
        
        // Configure behavior
        particles.emitRate = 100;
        particles.minEmitPower = 1;
        particles.maxEmitPower = 3;
        particles.updateSpeed = 0.01;
        
        // Configure emission pattern - explosion outward from center
        particles.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
        particles.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
        
        // Use additive blending for glow effect
        particles.blendMode = ParticleSystem.BLENDMODE_ADD;
        
        // Start the particles
        particles.start();
        
        // Store in our map
        this.deathEffects.set(id, particles);
        
        // Auto-cleanup after 3 seconds
        setTimeout(() => {
            if (this.deathEffects.has(id)) {
                this.deathEffects.get(id)!.dispose();
                this.deathEffects.delete(id);
            }
        }, 3000);
    }
    
    /**
     * Updates a remote player's position and state based on data from Firebase
     */
    private updateRemotePlayer(remotePlayer: Player, playerData: PlayerData): void {
        // Update position
        const position = new Vector3(
            playerData.position.x,
            playerData.position.y,
            playerData.position.z
        );
        
        // Update rotation
        const rotation = {
            x: playerData.rotation.x,
            y: playerData.rotation.y,
            z: playerData.rotation.z,
            w: playerData.rotation.w
        };
        
        // Apply updates
        remotePlayer.setRemotePosition(position);
        remotePlayer.setRemoteRotation(rotation);
        
        // Update jetpack state
        if (playerData.isJetpackActive) {
            remotePlayer.activateJetpack();
        } else {
            remotePlayer.deactivateJetpack();
        }
    }
    
    /**
     * Cleans up stale data from Firebase (old players, projectiles, effects)
     */
    private cleanupStaleData(): void {
        // Get the current time
        const currentTime = Date.now();
        
        // Only the first player to join becomes the host
        // The host is responsible for cleaning up stale data
        if (!this.isHost) {
            // Check if we should become the host (no other players or we're the oldest)
            onValue(this.playersRef, (snapshot) => {
                if (!snapshot.exists()) {
                    this.isHost = true;
                    return;
                }
                
                const players = snapshot.val();
                const playerUUIDs = Object.keys(players);
                
                // If we're the only player or the first in the list, become host
                if (playerUUIDs.length === 1 || playerUUIDs[0] === this.playerUUID) {
                    this.isHost = true;
                }
            }, { onlyOnce: true });
            
            // If we're still not host, don't do cleanup
            if (!this.isHost) return;
        }
        
        // Clean up stale player data (not updated in the last 10 seconds)
        onValue(this.playersRef, (snapshot) => {
            if (!snapshot.exists()) return;
            
            const updates: {[key: string]: any} = {};
            let hasUpdates = false;
            
            // Check each player
            snapshot.forEach((childSnapshot: DataSnapshot) => {
                const playerData = childSnapshot.val();
                const playerId = childSnapshot.key!;
                
                if (currentTime - playerData.lastUpdate > 10000) {
                    updates[playerId] = null; // Mark for removal
                    hasUpdates = true;
                    console.log("Cleaning up stale player:", playerId);
                }
                
                return false; // Don't cancel enumeration
            });
            
            // Apply updates if needed
            if (hasUpdates) {
                update(this.playersRef, updates);
            }
        }, { onlyOnce: true });
        
        // Clean up old projectiles (created more than 2 seconds ago)
        onValue(this.projectilesRef, (snapshot) => {
            if (!snapshot.exists()) return;
            
            const updates: {[key: string]: any} = {};
            let hasUpdates = false;
            
            // Check each projectile
            snapshot.forEach((childSnapshot: DataSnapshot) => {
                const projectileData = childSnapshot.val();
                const projectileId = childSnapshot.key!;
                
                if (currentTime - projectileData.createdAt > 2000) {
                    updates[projectileId] = null; // Mark for removal
                    hasUpdates = true;
                }
                
                return false; // Don't cancel enumeration
            });
            
            // Apply updates if needed
            if (hasUpdates) {
                update(this.projectilesRef, updates);
            }
        }, { onlyOnce: true });
        
        // Clean up old death effects (created more than 3 seconds ago)
        onValue(this.deathEffectsRef, (snapshot) => {
            if (!snapshot.exists()) return;
            
            const updates: {[key: string]: any} = {};
            let hasUpdates = false;
            
            // Check each death effect
            snapshot.forEach((childSnapshot: DataSnapshot) => {
                const effectData = childSnapshot.val();
                const effectId = childSnapshot.key!;
                
                if (currentTime - effectData.createdAt > 3000) {
                    updates[effectId] = null; // Mark for removal
                    hasUpdates = true;
                }
                
                return false; // Don't cancel enumeration
            });
            
            // Apply updates if needed
            if (hasUpdates) {
                update(this.deathEffectsRef, updates);
            }
        }, { onlyOnce: true });
    }
    
    /**
     * Disposes resources and removes player from Firebase when leaving
     */
    public dispose(): void {
        // Clear the cleanup timer
        clearInterval(this.cleanupTimer);
        
        // Remove player from Firebase
        remove(ref(database, `players/${this.playerUUID}`));
        
        // Clean up other players
        this.otherPlayers.forEach(player => player.dispose());
        this.otherPlayers.clear();
        
        // Clean up projectiles
        this.otherProjectiles.forEach(proj => proj.dispose());
        this.otherProjectiles.clear();
        
        // Clean up death effects
        this.deathEffects.forEach(effect => effect.dispose());
        this.deathEffects.clear();
    }

    /**
     * Updates all remote players
     * @param deltaTime Time since last frame for smooth interpolation
     */
    public updateRemotePlayers(deltaTime: number): void {
        // Update each remote player
        this.otherPlayers.forEach((player) => {
            player.update(deltaTime);
        });
        
        // Update remote projectiles and remove destroyed ones
        this.otherProjectiles.forEach((projectile, id) => {
            // If projectile returns false, it should be destroyed
            if (!projectile.update()) {
                projectile.dispose();
                // this.otherProjectiles.delete(id); // TODO is this necessary?
                // Also remove from Firebase if we're the host
                if (this.isHost) {
                    remove(ref(database, `projectiles/${id}`));
                }
            }
        });
    }
}