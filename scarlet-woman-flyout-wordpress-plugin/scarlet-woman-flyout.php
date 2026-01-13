<?php

/**
 * The plugin bootstrap file
 *
 * This file is read by WordPress to generate the plugin information in the plugin
 * admin area. This file also includes all of the dependencies used by the plugin,
 * registers the activation and deactivation functions, and defines a function
 * that starts the plugin.
 *
 * @link              https://scarlet.consulting
 * @since             1.0.0
 * @package           Scarlet_Woman_Flyout
 *
 * @wordpress-plugin
 * Plugin Name:       scarletbeast
 * Plugin URI:        https://scarletbeast.com
 * Description:       Flyout for speaking to the Scarlet Woman.
 * Version:           1.0.0
 * Author:            Christian Scarlet
 * Author URI:        https://scarlet.consulting/
 * License:           GPL-2.0+
 * License URI:       http://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain:       scarlet-woman-flyout
 * Domain Path:       /languages
 */

// If this file is called directly, abort.
if ( ! defined( 'WPINC' ) ) {
	die;
}

/**
 * Currently plugin version.
 * Start at version 1.0.0 and use SemVer - https://semver.org
 * Rename this for your plugin and update it as you release new versions.
 */
define( 'SCARLET_WOMAN_FLYOUT_VERSION', '1.0.0' );

/**
 * The code that runs during plugin activation.
 * This action is documented in includes/class-scarlet-woman-flyout-activator.php
 */
function activate_scarlet_woman_flyout() {
	require_once plugin_dir_path( __FILE__ ) . 'includes/class-scarlet-woman-flyout-activator.php';
	Scarlet_Woman_Flyout_Activator::activate();
}

/**
 * The code that runs during plugin deactivation.
 * This action is documented in includes/class-scarlet-woman-flyout-deactivator.php
 */
function deactivate_scarlet_woman_flyout() {
	require_once plugin_dir_path( __FILE__ ) . 'includes/class-scarlet-woman-flyout-deactivator.php';
	Scarlet_Woman_Flyout_Deactivator::deactivate();
}

register_activation_hook( __FILE__, 'activate_scarlet_woman_flyout' );
register_deactivation_hook( __FILE__, 'deactivate_scarlet_woman_flyout' );

/**
 * The core plugin class that is used to define internationalization,
 * admin-specific hooks, and public-facing site hooks.
 */
require plugin_dir_path( __FILE__ ) . 'includes/class-scarlet-woman-flyout.php';

/**
 * Begins execution of the plugin.
 *
 * Since everything within the plugin is registered via hooks,
 * then kicking off the plugin from this point in the file does
 * not affect the page life cycle.
 *
 * @since    1.0.0
 */
function run_scarlet_woman_flyout() {

	$plugin = new Scarlet_Woman_Flyout();
	$plugin->run();

}
run_scarlet_woman_flyout();
