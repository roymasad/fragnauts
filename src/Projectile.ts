import { Scene, Vector3, MeshBuilder, StandardMaterial, Color3, Color4, Mesh, ParticleSystem, Texture, AbstractMesh, Space, Matrix, Material } from "@babylonjs/core";

export class Projectile {
    private mesh: Mesh;
    private speed: number = 1; // Reduced from 3 to 1 for better gameplay
    private isActive: boolean = true;
    private lifespan: number = 800; //ms
    private spawnTime: number;
    private particles: ParticleSystem;
    private startDirection: Vector3;
    private ownerUUID: string; // Store the UUID of the player who fired this projectile

    constructor(
        private scene: Scene,
        position: Vector3,
        private direction: Vector3,
        private playerScale: number,
        private onHit: (target: AbstractMesh) => void,
        ownerUUID: string // The UUID of the player who created this projectile
    ) {
        this.ownerUUID = ownerUUID;
        
        // Create projectile mesh
        this.mesh = MeshBuilder.CreatePlane("projectile", { size: playerScale * 0.1 }, scene);
        this.mesh.position = position.clone();
        this.startDirection = direction.clone(); // Store initial direction for orbital movement
        
        // Make it always face the camera
        this.mesh.billboardMode = 7; // All axes (equivalent to BillboardMode.ALL)

        // Create material with proper transparency settings
        const material = new StandardMaterial("projectileMaterial", scene);
        material.diffuseTexture = new Texture("assets/textures/projectile.png", scene);
        material.diffuseTexture.hasAlpha = true;
        material.useAlphaFromDiffuseTexture = true;
        material.emissiveColor = new Color3(1.0, 1.0, 1.0); // Increased blue component
        material.alpha = 0.8;
        
        // Enable transparency and proper blending
        material.transparencyMode = Material.MATERIAL_ALPHABLEND;
        material.backFaceCulling = false;
        material.separateCullingPass = true;
        
        this.mesh.material = material;

        // Initialize particle system with improved settings
        this.particles = new ParticleSystem("projectileTrail", 100, scene);
        this.particles.particleTexture = new Texture("assets/textures/flare.png", scene);
        this.particles.emitter = this.mesh;
        this.particles.minEmitBox = new Vector3(0, 0, 0);
        this.particles.maxEmitBox = new Vector3(0, 0, 0);
        
        // Particle colors with proper alpha transition
        this.particles.color1 = new  Color4(1, 0.5, 0, 1);//Color4(0.2, 0.4, 1.0, 1.0); // Increased blue
        this.particles.color2 = new Color4(1, 0.1, 0, 0.8);//Color4(0.3, 0.5, 1.0, 0.8); // Increased blue
        this.particles.colorDead = new Color4(0.2, 0.1, 0, 0);//Color4(0.3, 0.5, 1.0, 0.0);
        
        // Adjust particle size
        this.particles.minSize = 0.1;
        this.particles.maxSize = 0.3;
        
        // Match particle lifetime with projectile lifespan
        this.particles.minLifeTime = 0.2;
        this.particles.maxLifeTime = 0.2;
        
        // Increase emit rate for better trail effect
        this.particles.emitRate = 100;
        this.particles.blendMode = ParticleSystem.BLENDMODE_ADD;
        
        // Improved particle movement
        this.particles.gravity = Vector3.Zero();
        this.particles.direction1 = direction.scale(-1);
        this.particles.direction2 = direction.scale(-1);
        this.particles.minEmitPower = 0.1;
        this.particles.maxEmitPower = 0.3;
        
        // Add particle randomization for better visual effect
        this.particles.minAngularSpeed = -0.5;
        this.particles.maxAngularSpeed = 0.5;
        
        // Start the particle system
        this.particles.start();

        this.spawnTime = Date.now();

        // Register the mesh for collisions
        this.mesh.checkCollisions = true;
    }

    public update(): boolean {
        if (!this.isActive) return false;

        // Check lifespan
        if (Date.now() - this.spawnTime > this.lifespan) {
            this.dispose();
            return false;
        }

        // Calculate orbital movement
        const toPlanetCenter = Vector3.Zero().subtract(this.mesh.position).normalize();
        
        // Calculate the orbital movement direction by crossing the initial direction with toPlanetCenter
        // This ensures movement is always tangent to the planet surface
        const orbitDirection = Vector3.Cross(this.startDirection, toPlanetCenter).normalize();
        
        // Create rotation matrix for orbital movement
        const rotationMatrix = Matrix.RotationAxis(orbitDirection, this.speed * 0.016); // 0.016 is roughly one frame at 60fps
        
        // Apply rotation to position while maintaining distance from planet
        const newPosition = Vector3.TransformCoordinates(this.mesh.position, rotationMatrix);
        this.mesh.position = newPosition;

        // Check for collisions with other players
        const hits = this.scene.meshes.filter(mesh => {
            // Only collide with player meshes
            if (mesh.name !== "player" || mesh === this.mesh) return false;
            
            // Get player UUID metadata if it exists
            const metadata = mesh.metadata;
            
            // Skip collision with the player who fired this projectile
            if (metadata && metadata.playerUUID === this.ownerUUID) return false;
            
            // Check for intersection
            return mesh.intersectsMesh(this.mesh, false);
        });

        if (hits.length > 0) {
            this.onHit(hits[0]);
            this.dispose();
            return false;
        }

        return true;
    }

    public dispose(): void {
        this.isActive = false;
        // Give particles time to fade out naturally
        const particleFadeTime = Math.max(this.particles.maxLifeTime * 1000, 500);
        setTimeout(() => {
            this.particles.dispose();
        }, particleFadeTime);
        this.mesh.dispose();
    }
}