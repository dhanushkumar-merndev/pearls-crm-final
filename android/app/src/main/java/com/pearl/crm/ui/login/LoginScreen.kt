package com.pearl.crm.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pearl.crm.R
import com.pearl.crm.ui.AuthLayout
import com.pearl.crm.core.data.auth.AuthFailure
import com.pearl.crm.core.data.auth.SessionManager
import com.pearl.crm.core.data.auth.SignOutReason
import com.pearl.crm.core.model.Username
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class LoginError { Wrong, TooMany, Offline, NoAccess }

data class LoginUiState(val busy: Boolean = false, val error: LoginError? = null)

class LoginViewModel(private val sessions: SessionManager) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun submit(username: String, password: String) {
        if (_state.value.busy) return
        _state.value = LoginUiState(busy = true)
        viewModelScope.launch {
            val error = try {
                sessions.signIn(username, password)
                null
            } catch (e: AuthFailure) {
                when (e) {
                    is AuthFailure.WrongCredentials, is AuthFailure.SessionEnded -> LoginError.Wrong
                    is AuthFailure.TooManyTries -> LoginError.TooMany
                    is AuthFailure.Offline -> LoginError.Offline
                    is AuthFailure.NotActive -> LoginError.NoAccess
                }
            }
            _state.value = LoginUiState(error = error)
        }
    }
}

/** Username + password only (owner's rule): no email, no codes, no reset links. */
@Composable
fun LoginScreen(state: LoginUiState, reason: SignOutReason?, onSubmit: (username: String, password: String) -> Unit) {
    var username by rememberSaveable { mutableStateOf("") }
    // Not saveable: the password never goes into the saved-state bundle.
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var usernameError by remember { mutableStateOf<Int?>(null) }
    var passwordError by remember { mutableStateOf<Int?>(null) }
    var forgotOpen by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        usernameError = when {
            username.isBlank() -> R.string.login_required
            !Username.isValid(username) -> R.string.login_username_rule
            else -> null
        }
        passwordError = if (password.isEmpty()) R.string.login_required else null
        if (usernameError == null && passwordError == null) onSubmit(Username.normalize(username), password)
    }

    AuthLayout(stringResource(R.string.login_title), stringResource(R.string.login_subtitle)) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.l), horizontalAlignment = Alignment.CenterHorizontally) {
            reasonText(reason)?.let { StatusLabel(it, StatusTone.Warning) }
            OutlinedTextField(
                value = username,
                onValueChange = {
                    username = it
                    usernameError = null
                },
                label = { Text(stringResource(R.string.login_username)) },
                singleLine = true,
                isError = usernameError != null,
                supportingText = usernameError?.let { { Text(stringResource(it)) } },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Next,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = {
                    password = it
                    passwordError = null
                },
                label = { Text(stringResource(R.string.login_password)) },
                singleLine = true,
                isError = passwordError != null,
                supportingText = passwordError?.let { { Text(stringResource(it)) } },
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { showPassword = !showPassword }) {
                        Icon(
                            if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            contentDescription = stringResource(if (showPassword) R.string.login_hide_password else R.string.login_show_password),
                        )
                    }
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                modifier = Modifier.fillMaxWidth(),
            )
            state.error?.let { StatusLabel(stringResource(errorText(it)), StatusTone.Critical) }
            PearlButton(
                stringResource(R.string.login_submit),
                Icons.AutoMirrored.Outlined.Login,
                ::submit,
                modifier = Modifier.fillMaxWidth(),
                busy = state.busy,
            )
            PearlButton(
                stringResource(R.string.login_forgot),
                Icons.AutoMirrored.Outlined.HelpOutline,
                { forgotOpen = true },
                kind = ButtonKind.Quiet,
            )
        }
    }

    if (forgotOpen) {
        AlertDialog(
            onDismissRequest = { forgotOpen = false },
            title = { Text(stringResource(R.string.login_forgot_title)) },
            text = { Text(stringResource(R.string.login_forgot_body)) },
            confirmButton = {
                PearlButton(stringResource(R.string.login_ok), Icons.Outlined.Check, { forgotOpen = false }, kind = ButtonKind.Quiet)
            },
        )
    }
}

private fun errorText(error: LoginError): Int = when (error) {
    LoginError.Wrong -> R.string.login_wrong
    LoginError.TooMany -> R.string.login_too_many
    LoginError.Offline -> R.string.login_offline
    LoginError.NoAccess -> R.string.login_no_access
}

@Composable
private fun reasonText(reason: SignOutReason?): String? = when (reason) {
    null, SignOutReason.UserChoice -> null
    SignOutReason.SessionEnded -> stringResource(R.string.login_reason_session)
    SignOutReason.Inactive -> stringResource(R.string.login_reason_inactive)
    SignOutReason.PinLockout -> stringResource(R.string.login_reason_pin)
    SignOutReason.ForgotPin -> stringResource(R.string.login_reason_forgot_pin)
}
