<?php

/**
 * Define the internationalization functionality
 *
 * Loads and defines the internationalization files for this plugin
 * so that it is ready for translation.
 *
 * @link       https://scarlet.consulting
 * @since      1.0.0
 *
 * @package    Scarlet_Woman_Flyout
 * @subpackage Scarlet_Woman_Flyout/includes
 */

/**
 * Define the internationalization functionality.
 *
 * Loads and defines the internationalization files for this plugin
 * so that it is ready for translation.
 *
 * @since      1.0.0
 * @package    Scarlet_Woman_Flyout
 * @subpackage Scarlet_Woman_Flyout/includes
 * @author     Christian Scarlet <scarlet@scarletbeast.com>
 */
class Scarlet_Woman_Flyout_i18n {


	/**
	 * Load the plugin text domain for translation.
	 *
	 * @since    1.0.0
	 */
	public function load_plugin_textdomain() {

		load_plugin_textdomain(
			'scarlet-woman-flyout',
			false,
			dirname( dirname( plugin_basename( __FILE__ ) ) ) . '/languages/'
		);

	}



}
