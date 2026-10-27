import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// The backend address comes from the repo's root .env (the same browser-safe keys the web app
// uses) or from environment variables (CI). Missing → the app shows "not set up yet".
val rootEnv: Map<String, String> = rootProject.file("../.env").let { file ->
    if (!file.exists()) {
        emptyMap()
    } else {
        file.readLines().mapNotNull { line ->
            val text = line.trim()
            if (text.isEmpty() || text.startsWith("#") || '=' !in text) {
                null
            } else {
                text.substringBefore('=').trim() to
                    text.substringAfter('=').trim().removeSurrounding("\"").removeSurrounding("'")
            }
        }.toMap()
    }
}

fun backend(key: String): String = System.getenv(key)?.takeIf { it.isNotBlank() } ?: rootEnv[key].orEmpty()

fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// Push needs the owner's Firebase file (dev-docs/SETUP.md, git-ignored). Without it the app
// builds and runs; it just gets no push notifications.
val pushEnabled = file("google-services.json").exists()
if (pushEnabled) apply(plugin = libs.plugins.google.services.get().pluginId)

// Release signing (dev-docs/RELEASE_ANDROID.md): android/keystore.properties on the owner's PC
// (git-ignored, like the keystore itself) or PEARL_KEYSTORE_* environment variables in CI.
// Without either, assembleRelease still builds, unsigned.
fun propertiesOf(file: File): Map<String, String> = if (!file.exists()) {
    emptyMap()
} else {
    Properties().apply { file.inputStream().use { load(it) } }.entries.associate { it.key.toString() to it.value.toString() }
}
val keystore = propertiesOf(rootProject.file("keystore.properties"))
fun signing(key: String, env: String): String? = System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystore[key]
val keystoreFile = signing("storeFile", "PEARL_KEYSTORE_FILE")?.let { rootProject.file(it) }

// Bump both in android/version.properties for every release given to staff.
val version = propertiesOf(rootProject.file("version.properties"))

android {
    namespace = "com.pearl.crm"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pearl.crm"
        minSdk = 26
        targetSdk = 36
        versionCode = version.getValue("versionCode").toInt()
        versionName = version.getValue("versionName")
        buildConfigField("String", "SUPABASE_URL", quoted(backend("NEXT_PUBLIC_SUPABASE_URL")))
        buildConfigField("String", "SUPABASE_ANON_KEY", quoted(backend("NEXT_PUBLIC_SUPABASE_ANON_KEY")))
        buildConfigField("boolean", "PUSH_ENABLED", pushEnabled.toString())
        // On-device tests (src/androidTest, run on a real phone by `pnpm phone:test`).
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        if (keystoreFile?.exists() == true) {
            create("release") {
                storeFile = keystoreFile
                storePassword = signing("storePassword", "PEARL_KEYSTORE_PASSWORD")
                keyAlias = signing("keyAlias", "PEARL_KEY_ALIAS")
                keyPassword = signing("keyPassword", "PEARL_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        // Each on-device test in its own process: one crash can't take the rest down.
        execution = "ANDROIDX_TEST_ORCHESTRATOR"
    }

    lint {
        abortOnError = true
        checkDependencies = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(project(":core:sync"))
    implementation(project(":core:ui"))
    implementation(project(":feature:settings"))
    implementation(project(":feature:sales"))
    implementation(project(":feature:bdm"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.work.runtime)
    implementation(libs.kotlinx.coroutines.android)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.kotlinx.coroutines.test)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.uiautomator)
    androidTestImplementation(libs.androidx.test.espresso.intents)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestUtil(libs.androidx.test.orchestrator)
}
