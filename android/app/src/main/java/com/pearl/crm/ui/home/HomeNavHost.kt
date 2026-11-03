package com.pearl.crm.ui.home

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost

/** The signed-in navigation graph, shared by all staff roles. */
@Composable
internal fun HomeNavHost(
    navController: NavHostController,
    tabs: List<HomeTab>,
    modifier: Modifier = Modifier,
    builder: NavGraphBuilder.() -> Unit,
) {
    NavHost(
        navController,
        startDestination = tabs.first().route,
        modifier = modifier.fillMaxSize().clipToBounds().background(MaterialTheme.colorScheme.background),
        enterTransition = { slideIntoContainer(slideDirection(tabs), tween(220, easing = FastOutSlowInEasing)) },
        exitTransition = { slideOutOfContainer(slideDirection(tabs), tween(220, easing = FastOutSlowInEasing)) },
        popEnterTransition = { slideIntoContainer(slideDirection(tabs, popping = true), tween(220, easing = FastOutSlowInEasing)) },
        popExitTransition = { slideOutOfContainer(slideDirection(tabs, popping = true), tween(220, easing = FastOutSlowInEasing)) },
        builder = builder,
    )
}

/** Physical tab order wins for tabs; pushing a detail goes left and closing it goes right. */
private fun AnimatedContentTransitionScope<NavBackStackEntry>.slideDirection(
    tabs: List<HomeTab>,
    popping: Boolean = false,
): AnimatedContentTransitionScope.SlideDirection {
    val from = tabs.indexOfFirst { it.route == initialState.destination.route }
    val to = tabs.indexOfFirst { it.route == targetState.destination.route }
    val towardsRight = if (from >= 0 && to >= 0) to < from else popping
    return if (towardsRight) AnimatedContentTransitionScope.SlideDirection.Right else AnimatedContentTransitionScope.SlideDirection.Left
}
